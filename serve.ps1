# 보카이브 실습 앱용 간단한 로컬 서버 (Node/Python 없이 실행)
# 사용법: powershell -ExecutionPolicy Bypass -File serve.ps1   →  http://localhost:5173
param([int]$Port = 5173)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$types = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml'; '.png'='image/png' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Vocaive running at http://localhost:$Port  (stop: Ctrl+C)"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ($path -eq '') { $path = 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path))
      if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $ctx.Response.Headers.Add('Cache-Control', 'no-store')
        $ctx.Response.ContentLength64 = $bytes.Length
        if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
      } else {
        $ctx.Response.StatusCode = 404
      }
    } catch {
      Write-Host "request error: $($_.Exception.Message)"
    } finally {
      try { $ctx.Response.Close() } catch {}
    }
  }
} finally { $listener.Stop() }
