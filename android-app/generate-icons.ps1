# Gera icones Android a partir do icone Samsung TV
$root = $PSScriptRoot
$src = Join-Path (Split-Path $root -Parent) "samsung-tv\icon.png"
$res = Join-Path $root "app\src\main\res"

if (-not (Test-Path $src)) {
  Write-Host "Icone fonte nao encontrado: $src" -ForegroundColor Red
  exit 1
}

Add-Type -AssemblyName System.Drawing

$sizes = @{
  "mipmap-mdpi"    = 48
  "mipmap-hdpi"    = 72
  "mipmap-xhdpi"   = 96
  "mipmap-xxhdpi"  = 144
  "mipmap-xxxhdpi" = 192
}

$source = [System.Drawing.Image]::FromFile($src)

foreach ($folder in $sizes.Keys) {
  $size = $sizes[$folder]
  $dir = Join-Path $res $folder
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($source, 0, 0, $size, $size)

  $bmp.Save((Join-Path $dir "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Save((Join-Path $dir "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Save((Join-Path $dir "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)

  $g.Dispose()
  $bmp.Dispose()
}

$source.Dispose()
Write-Host "Icones Android gerados." -ForegroundColor Green