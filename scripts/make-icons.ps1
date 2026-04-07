$dir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Add-Type -AssemblyName System.Drawing

function New-IconPng($size, $name) {
  $bmp = New-Object Drawing.Bitmap $size, $size
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([Drawing.Color]::FromArgb(37, 99, 235))
  $fontSize = [Math]::Max(10, [int]($size / 5))
  $font = New-Object Drawing.Font("Segoe UI", $fontSize, [Drawing.FontStyle]::Bold)
  $brush = New-Object Drawing.SolidBrush([Drawing.Color]::White)
  $format = New-Object Drawing.StringFormat
  $format.Alignment = [Drawing.StringAlignment]::Center
  $format.LineAlignment = [Drawing.StringAlignment]::Center
  $rect = New-Object Drawing.RectangleF 0, 0, $size, $size
  $g.DrawString("LOG", $font, $brush, $rect, $format)
  $path = Join-Path $dir $name
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

New-IconPng 192 "icon-192.png"
New-IconPng 512 "icon-512.png"
Write-Host "Wrote icons to $dir"
