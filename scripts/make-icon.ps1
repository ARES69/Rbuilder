# Generates the RBUILDER app icon (dark gradient tile with a bold "R").
Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 16, 19, 26),
    [System.Drawing.Color]::FromArgb(255, 41, 57, 92),
    45.0)
$g.FillRectangle($brush, $rect)

# Accent bar on the left edge
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 122, 162, 255))
$g.FillRectangle($accent, 0, 0, 44, $size)

$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center

$font = New-Object System.Drawing.Font('Segoe UI', 460, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('R', $font, [System.Drawing.Brushes]::White, [single]30, [single]-20)

$g.Dispose()
$out = Join-Path $PSScriptRoot '..\app-icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Icon written to $out"
