#Requires -Version 5.1
<#
.SYNOPSIS
    Banc de mesure du plan d'alimentation : EPP (CPPC2), Turbo et plafond MHz.

.DESCRIPTION
    Mesure une charge deterministe mono-thread sous plusieurs phases, en lisant et
    ecrivant les policies par l'API powrprof (comme le crate), jamais par powercfg :
    powercfg n'affiche pas les policies sans valeur stockee et renvoie des codes
    trompeurs.

    Pour chaque passe : duree du travail fixe + frequence maximale relevee pendant
    la charge (CallNtPowerInformation). Le checksum prouve que le travail est
    identique d'une phase a l'autre.

    Les valeurs initiales AC et DC sont restaurees dans un bloc finally, meme si
    le script echoue. Le script refuse de tourner sans elevation.

.EXAMPLE
    .\scripts\measure-cppc.ps1 -DryRun
    .\scripts\measure-cppc.ps1 -Passes 4
#>
[CmdletBinding()]
param(
    [int]$Passes = 4,
    [int]$TargetMs = 1500,
    [string]$OutFile = "",
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ASCII uniquement : PowerShell 5.1 lit un .ps1 sans BOM comme de l'ANSI.
$SUB_PROCESSOR = [Guid]'54533251-82be-4824-96c1-47b60b740d00'
$GUID_EPP      = [Guid]'36687f9e-e3a5-4dbf-b1dc-15eb381c6863'
$GUID_BOOST    = [Guid]'be337238-0d82-4146-a960-4f3749d470c7'
$GUID_CAP      = [Guid]'75b0ae3f-bce0-45a7-8c89-c9611c25e100'

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class EcoClockBench
{
    [DllImport("powrprof.dll")]
    private static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr scheme);

    [DllImport("powrprof.dll")]
    private static extern uint PowerReadACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);

    [DllImport("powrprof.dll")]
    private static extern uint PowerReadDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);

    [DllImport("powrprof.dll")]
    private static extern uint PowerWriteACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);

    [DllImport("powrprof.dll")]
    private static extern uint PowerWriteDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);

    [DllImport("powrprof.dll")]
    private static extern uint PowerSetActiveScheme(IntPtr root, ref Guid scheme);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr handle);

    [DllImport("powrprof.dll")]
    private static extern int CallNtPowerInformation(int level, IntPtr input, uint inputSize, IntPtr output, uint outputSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessorPowerInformation
    {
        public uint Number;
        public uint MaxMhz;
        public uint CurrentMhz;
        public uint MhzLimit;
        public uint MaxIdleState;
        public uint CurrentIdleState;
    }

    public static Guid GetActiveScheme()
    {
        IntPtr ptr;
        uint rc = PowerGetActiveScheme(IntPtr.Zero, out ptr);
        if (rc != 0) { throw new InvalidOperationException("PowerGetActiveScheme: " + rc); }
        Guid scheme = (Guid)Marshal.PtrToStructure(ptr, typeof(Guid));
        LocalFree(ptr);
        return scheme;
    }

    public static uint ReadAc(Guid scheme, Guid sub, Guid setting)
    {
        uint value;
        uint rc = PowerReadACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref setting, out value);
        return rc == 0 ? value : uint.MaxValue;
    }

    public static uint ReadDc(Guid scheme, Guid sub, Guid setting)
    {
        uint value;
        uint rc = PowerReadDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref setting, out value);
        return rc == 0 ? value : uint.MaxValue;
    }

    public static bool WriteAc(Guid scheme, Guid sub, Guid setting, uint value)
    {
        return PowerWriteACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref setting, value) == 0;
    }

    public static bool WriteDc(Guid scheme, Guid sub, Guid setting, uint value)
    {
        return PowerWriteDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref setting, value) == 0;
    }

    // Sans reactivation, le systeme peut conserver les anciennes valeurs : l ecriture
    // seule ne suffit pas. Le crate appelle PowerSetActiveScheme apres chaque application.
    public static bool Activate(Guid scheme)
    {
        return PowerSetActiveScheme(IntPtr.Zero, ref scheme) == 0;
    }

    // Travail fixe, dependant des seules iterations : le checksum doit etre
    // identique partout, sinon les phases ne mesurent pas la meme chose.
    public static long Work(long iterations)
    {
        uint x = 2654435769u;
        for (long i = 0; i < iterations; i++)
        {
            x = x * 1664525u + 1013904223u;
            x = x ^ (x >> 13);
        }
        return (long)x;
    }

    // [max, moyenne] des frequences courantes rapportees par le firmware.
    public static double[] CpuMhz()
    {
        int n = Environment.ProcessorCount;
        int size = Marshal.SizeOf(typeof(ProcessorPowerInformation));
        IntPtr buf = Marshal.AllocHGlobal(size * n);
        try
        {
            int rc = CallNtPowerInformation(11, IntPtr.Zero, 0, buf, (uint)(size * n));
            if (rc != 0) { return new double[] { 0.0, 0.0 }; }
            double max = 0.0;
            double sum = 0.0;
            for (int i = 0; i < n; i++)
            {
                ProcessorPowerInformation p = (ProcessorPowerInformation)Marshal.PtrToStructure(
                    new IntPtr(buf.ToInt64() + i * size), typeof(ProcessorPowerInformation));
                if (p.CurrentMhz > max) { max = p.CurrentMhz; }
                sum += p.CurrentMhz;
            }
            return new double[] { max, sum / n };
        }
        finally
        {
            Marshal.FreeHGlobal(buf);
        }
    }
}
'@

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $DryRun) {
    throw "Ce banc ecrit dans le plan d'alimentation actif : relance-le eleve (Administrateur)."
}

# Matrice : chaque phase ne change qu'un levier par rapport a la reference.
$phases = @(
    @{ Name = 'ref-debut';   Epp = 50;  Boost = 3; Cap = 0 },
    @{ Name = 'epp-0';       Epp = 0;   Boost = 3; Cap = 0 },
    @{ Name = 'epp-50';      Epp = 50;  Boost = 3; Cap = 0 },
    @{ Name = 'epp-100';     Epp = 100; Boost = 3; Cap = 0 },
    @{ Name = 'boost-aggr';  Epp = 50;  Boost = 2; Cap = 0 },
    @{ Name = 'boost-eff';   Epp = 50;  Boost = 3; Cap = 0 },
    @{ Name = 'boost-off';   Epp = 50;  Boost = 0; Cap = 0 },
    @{ Name = 'cap-3300';    Epp = 50;  Boost = 3; Cap = 3300 },
    @{ Name = 'cap-2000';    Epp = 50;  Boost = 3; Cap = 2000 },
    @{ Name = 'cap-0';       Epp = 50;  Boost = 3; Cap = 0 },
    @{ Name = 'ref-fin';     Epp = 50;  Boost = 3; Cap = 0 }
)

$scheme = [EcoClockBench]::GetActiveScheme()
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name

$csv = if ([string]::IsNullOrWhiteSpace($OutFile)) {
    Join-Path $PSScriptRoot "..\measurements\cppc2-$env:COMPUTERNAME.csv"
} else {
    $OutFile
}
$csv = [System.IO.Path]::GetFullPath($csv)
$dir = Split-Path -Parent $csv
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$log = Join-Path $dir ("run-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")

$initial = @{
    Epp   = @{ Ac = [EcoClockBench]::ReadAc($scheme, $SUB_PROCESSOR, $GUID_EPP);   Dc = [EcoClockBench]::ReadDc($scheme, $SUB_PROCESSOR, $GUID_EPP) }
    Boost = @{ Ac = [EcoClockBench]::ReadAc($scheme, $SUB_PROCESSOR, $GUID_BOOST); Dc = [EcoClockBench]::ReadDc($scheme, $SUB_PROCESSOR, $GUID_BOOST) }
    Cap   = @{ Ac = [EcoClockBench]::ReadAc($scheme, $SUB_PROCESSOR, $GUID_CAP);   Dc = [EcoClockBench]::ReadDc($scheme, $SUB_PROCESSOR, $GUID_CAP) }
}

function Format-Index($value) {
    if ($value -eq [uint32]::MaxValue) { return 'absent' }
    return [string]$value
}

function Set-Phase([uint32]$epp, [uint32]$boost, [uint32]$cap) {
    [void][EcoClockBench]::WriteAc($scheme, $SUB_PROCESSOR, $GUID_EPP, $epp)
    [void][EcoClockBench]::WriteDc($scheme, $SUB_PROCESSOR, $GUID_EPP, $epp)
    [void][EcoClockBench]::WriteAc($scheme, $SUB_PROCESSOR, $GUID_BOOST, $boost)
    [void][EcoClockBench]::WriteDc($scheme, $SUB_PROCESSOR, $GUID_BOOST, $boost)
    [void][EcoClockBench]::WriteAc($scheme, $SUB_PROCESSOR, $GUID_CAP, $cap)
    [void][EcoClockBench]::WriteDc($scheme, $SUB_PROCESSOR, $GUID_CAP, $cap)
    [void][EcoClockBench]::Activate($scheme)
    return [pscustomobject]@{
        Epp   = [EcoClockBench]::ReadAc($scheme, $SUB_PROCESSOR, $GUID_EPP)
        Boost = [EcoClockBench]::ReadAc($scheme, $SUB_PROCESSOR, $GUID_BOOST)
        Cap   = [EcoClockBench]::ReadAc($scheme, $SUB_PROCESSOR, $GUID_CAP)
    }
}

function Measure-Pass([long]$iterations) {
    $chunk = [long][Math]::Max(1, [Math]::Floor($iterations / 20))
    $max = 0.0
    $sumAvg = 0.0
    $samples = 0
    $checksum = 0L
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    for ($i = 0; $i -lt 20; $i++) {
        $checksum = [EcoClockBench]::Work($chunk)
        $mhz = [EcoClockBench]::CpuMhz()
        if ($mhz[0] -gt $max) { $max = $mhz[0] }
        $sumAvg += $mhz[1]
        $samples++
    }
    $sw.Stop()
    return [pscustomobject]@{
        Ms       = [Math]::Round($sw.Elapsed.TotalMilliseconds, 2)
        MaxMhz   = [Math]::Round($max, 0)
        AvgMhz   = [Math]::Round($sumAvg / $samples, 0)
        Checksum = $checksum
    }
}

function Get-Median([double[]]$values) {
    if ($null -eq $values -or $values.Count -eq 0) { return 0 }
    $sorted = @($values | Sort-Object)
    $n = $sorted.Count
    if ($n % 2 -eq 1) { return [double]$sorted[[int](($n - 1) / 2)] }
    return ([double]$sorted[$n / 2 - 1] + [double]$sorted[$n / 2]) / 2
}

Write-Host "CPU      : $cpu"
Write-Host "Plan     : $scheme"
Write-Host ("Initial  : EPP={0} Turbo={1} Plafond={2} (AC)" -f (Format-Index $initial.Epp.Ac), (Format-Index $initial.Boost.Ac), (Format-Index $initial.Cap.Ac))
Write-Host "Passes   : $Passes x $TargetMs ms"
Write-Host "Sortie   : $csv"

if ($DryRun) {
    Write-Host ''
    Write-Host 'Matrice (aucune ecriture en mode -DryRun) :'
    $phases | ForEach-Object { [pscustomobject]$_ } | Format-Table Name, Epp, Boost, Cap -AutoSize | Out-String | Write-Host
    Write-Host 'Pour mesurer : relancer sans -DryRun, dans une console elevee.'
    exit 0
}

Start-Transcript -Path $log -Force | Out-Null
$rows = New-Object System.Collections.Generic.List[object]
$exitCode = 0

try {
    # Chauffe du JIT puis calibration : le meme nombre d'iterations sera utilise
    # partout, pour que seul le plan d'alimentation change entre deux phases.
    [void][EcoClockBench]::Work(50000000)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    [void][EcoClockBench]::Work(200000000)
    $sw.Stop()
    $probeMs = [Math]::Max(1.0, $sw.Elapsed.TotalMilliseconds)
    $iterations = [long]([Math]::Floor(200000000 * ($TargetMs / $probeMs) / 20) * 20)
    Write-Host ("Calibration : 200 M iterations en {0:N0} ms -> {1:N0} iterations par passe." -f $probeMs, $iterations)

    # Chauffe thermique : sans elle, ref-debut mesure un CPU froid et surestime le
    # debit de plusieurs pourcents, soit plus que les effets cherches.
    $warmIterations = [long]([Math]::Floor($iterations * (3.0 / $TargetMs) / 20) * 20)
    Write-Host 'Chauffe thermique : 3 s...'
    [void][EcoClockBench]::Work($warmIterations)
    Write-Host ''

    foreach ($phase in $phases) {
        $state = Set-Phase ([uint32]$phase.Epp) ([uint32]$phase.Boost) ([uint32]$phase.Cap)
        $relu = "EPP={0} Turbo={1} Plafond={2}" -f (Format-Index $state.Epp), (Format-Index $state.Boost), (Format-Index $state.Cap)
        Write-Host ("[{0}] relu {1}" -f $phase.Name, $relu)

        for ($p = 1; $p -le $Passes; $p++) {
            $m = Measure-Pass $iterations
            $rows.Add([pscustomobject]@{
                phase    = $phase.Name
                epp      = $phase.Epp
                turbo    = $phase.Boost
                cap_mhz  = $phase.Cap
                pass     = $p
                ms       = $m.Ms
                max_mhz  = $m.MaxMhz
                avg_mhz  = $m.AvgMhz
                checksum = $m.Checksum
            })
            Write-Host ("  passe {0}/{1} : {2,8:N2} ms  {3,5:N0} MHz max  {4,5:N0} MHz moy" -f $p, $Passes, $m.Ms, $m.MaxMhz, $m.AvgMhz)
        }
    }

    $checksums = @($rows | ForEach-Object { $_.checksum } | Sort-Object -Unique)
    if ($checksums.Count -ne 1) {
        Write-Host "[ATTENTION] Les checksums different : le travail n'etait pas identique." -ForegroundColor Yellow
        $exitCode = 1
    }

    $reference = Get-Median ([double[]]@($rows | Where-Object { $_.phase -eq 'ref-debut' } | ForEach-Object { $_.ms }))
    $summary = foreach ($phase in $phases) {
        $selected = @($rows | Where-Object { $_.phase -eq $phase.Name })
        $ms = Get-Median ([double[]]@($selected | ForEach-Object { $_.ms }))
        $mhz = Get-Median ([double[]]@($selected | ForEach-Object { $_.max_mhz }))
        [pscustomobject]@{
            phase   = $phase.Name
            ms      = [Math]::Round($ms, 2)
            delta_p = if ($reference -gt 0) { [Math]::Round((($ms / $reference) - 1) * 100, 1) } else { 0 }
            max_mhz = [Math]::Round($mhz, 0)
        }
    }

    Write-Host ''
    $summary | Format-Table phase, ms, delta_p, max_mhz -AutoSize | Out-String | Write-Host

    # CSV invariant : Export-Csv suit la culture (separateur et virgule decimale
    # francais), ce qui rend le fichier illisible pour un outil non francais.
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('phase,epp,turbo,cap_mhz,pass,ms,max_mhz,avg_mhz,checksum')
    $inv = [System.Globalization.CultureInfo]::InvariantCulture
    foreach ($r in $rows) {
        $lines.Add(('{0},{1},{2},{3},{4},{5},{6},{7},{8}' -f $r.phase, $r.epp, $r.turbo, $r.cap_mhz, $r.pass,
            $r.ms.ToString($inv), $r.max_mhz.ToString($inv), $r.avg_mhz.ToString($inv), $r.checksum))
    }
    [System.IO.File]::WriteAllLines($csv, $lines, [System.Text.Encoding]::ASCII)
    Write-Host "CSV ecrit : $csv"

    if (@($rows | ForEach-Object { $_.max_mhz } | Sort-Object -Unique).Count -eq 1) {
        Write-Host '[INFO] Frequence rapportee constante : le firmware expose la frequence nominale, pas le boost. Seul le temps fait foi.' -ForegroundColor Yellow
    }
}
catch {
    Write-Host "[ERREUR] $_" -ForegroundColor Red
    $exitCode = 1
}
finally {
    [void][EcoClockBench]::WriteAc($scheme, $SUB_PROCESSOR, $GUID_EPP, [uint32]$initial.Epp.Ac)
    [void][EcoClockBench]::WriteDc($scheme, $SUB_PROCESSOR, $GUID_EPP, [uint32]$initial.Epp.Dc)
    [void][EcoClockBench]::WriteAc($scheme, $SUB_PROCESSOR, $GUID_BOOST, [uint32]$initial.Boost.Ac)
    [void][EcoClockBench]::WriteDc($scheme, $SUB_PROCESSOR, $GUID_BOOST, [uint32]$initial.Boost.Dc)
    [void][EcoClockBench]::WriteAc($scheme, $SUB_PROCESSOR, $GUID_CAP, [uint32]$initial.Cap.Ac)
    [void][EcoClockBench]::WriteDc($scheme, $SUB_PROCESSOR, $GUID_CAP, [uint32]$initial.Cap.Dc)

    $after = [pscustomobject]@{
        Epp   = [EcoClockBench]::ReadAc($scheme, $SUB_PROCESSOR, $GUID_EPP)
        Boost = [EcoClockBench]::ReadAc($scheme, $SUB_PROCESSOR, $GUID_BOOST)
        Cap   = [EcoClockBench]::ReadAc($scheme, $SUB_PROCESSOR, $GUID_CAP)
    }
    Write-Host ("Restaure : EPP={0} Turbo={1} Plafond={2}" -f (Format-Index $after.Epp), (Format-Index $after.Boost), (Format-Index $after.Cap))
    if ($after.Epp -ne $initial.Epp.Ac -or $after.Boost -ne $initial.Boost.Ac -or $after.Cap -ne $initial.Cap.Ac) {
        Write-Host '[ATTENTION] La restauration ne correspond pas a l etat initial.' -ForegroundColor Yellow
        $exitCode = 1
    }
    Stop-Transcript | Out-Null
}

exit $exitCode
