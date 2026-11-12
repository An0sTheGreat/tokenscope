# Draws the Tokenscope app icon (rounded-square gradient with a ring-meter glyph) at 16, 20, 24, 32, 48, 64
# and 256 px and writes them as PNG-in-ICO frames to src/Tokenscope/app.ico. Run: powershell -File scripts/make-icon.ps1
Add-Type -AssemblyName System.Drawing

$sizes = 16, 20, 24, 32, 48, 64, 256
$out = Join-Path $PSScriptRoot '..\src\Tokenscope\app.ico'

# Each size is drawn directly (anti-aliased), never scaled from another frame.
function Render([int]$size) {
    $s = [single]$size
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded square, radius ~22% of the side.
    $d = 2 * [single](56 / 256 * $s)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc([single]0, [single]0, $d, $d, 180, 90)
    $path.AddArc($s - $d, [single]0, $d, $d, 270, 90)
    $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
    $path.AddArc([single]0, $s - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF $s, $s), ([System.Drawing.Color]::FromArgb(255, 94, 92, 230)), ([System.Drawing.Color]::FromArgb(255, 10, 132, 255))
    $g.FillPath($grad, $path)

    # Ring glyph: faint full track plus a bright 270-degree meter arc.
    # At 16-24 px the 256 px proportions (thin ring, faint track) blur away: use a thicker ring and a brighter track.
    if ($size -le 24) { $inset = 0.22 * $s; $width = 0.17 * $s; $trackAlpha = 110 }
    else { $inset = 60 / 256 * $s; $width = 26 / 256 * $s; $trackAlpha = 70 }
    $box = New-Object System.Drawing.RectangleF ([single]$inset), ([single]$inset), ([single]($s - 2 * $inset)), ([single]($s - 2 * $inset))
    $track = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($trackAlpha, 255, 255, 255)), ([single]$width)
    $g.DrawEllipse($track, $box)
    $arc = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([single]$width)
    $arc.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $arc.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($arc, $box, -90, 270)
    $g.Dispose()

    $png = New-Object System.IO.MemoryStream
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    , $png.ToArray()
}

$frames = @($sizes | ForEach-Object { , (Render $_) })

# ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) per frame + the PNG data. Width/height 0 means 256.
$fs = [System.IO.File]::Create($out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([Byte]$dim); $w.Write([Byte]$dim); $w.Write([Byte]0); $w.Write([Byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$frames[$i].Length); $w.Write([UInt32]$offset)
    $offset += $frames[$i].Length
}
foreach ($f in $frames) { $w.Write($f) }
$w.Dispose()
Write-Output "wrote $out ($offset bytes, $($sizes.Count) frames)"
