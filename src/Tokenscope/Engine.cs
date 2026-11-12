using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Tokenscope;

/// Validates a `run` request's argument vector against the spec's allow-lists.
static partial class ArgPolicy
{
    static readonly HashSet<string> Sources = [
        "claude", "codex", "opencode", "amp", "droid", "codebuff", "cline", "hermes", "pi", "goose",
        "openclaw", "kilo", "kimi", "qwen", "copilot", "gemini", "antigravity", "grok", "zcode",
    ];
    static readonly HashSet<string> Commands = ["daily", "weekly", "monthly", "session", "blocks"];

    // Flags that take no value.
    static readonly HashSet<string> Switches = ["--by-agent", "--breakdown", "--instances", "--offline", "--active", "--recent"];

    // Flags that require exactly one value (see SafeValue; never starting with '-' or '/', no "..").
    // ccusage marks --mode, --order and --session-length as optional-value; the host still requires one.
    static readonly HashSet<string> ValueFlags = [
        "--sections", "--project", "--since", "--until", "--last", "--timezone", "--mode", "--order",
        "--start-of-week", "--token-limit", "--session-length", "--id",
    ];

    // \z, not $: $ would also match before a trailing newline.
    [GeneratedRegex(@"^[A-Za-z0-9._:,/+-]{1,200}\z")]
    private static partial Regex SafeValue();

    /// null = allowed, else the reason.
    public static string? Validate(string[] args)
    {
        int i = args.Length > 0 && Sources.Contains(args[0]) ? 1 : 0;
        if (i >= args.Length || !Commands.Contains(args[i]))
            return "expected one of: daily weekly monthly session blocks";
        for (i++; i < args.Length; i++)
        {
            var a = args[i];
            if (Switches.Contains(a)) continue;
            if (a is null || !ValueFlags.Contains(a)) return $"argument not allowed: {a}";
            if (++i >= args.Length || string.IsNullOrEmpty(args[i]) || args[i].StartsWith('-'))
                return $"{a} needs a value";
            if (!SafeValue().IsMatch(args[i]) || args[i].Contains("..") || args[i].StartsWith('/'))
                return $"{a} value not allowed: {args[i]}";
        }
        return null;
    }
}

/// The bundled ccusage engine: unpacking and running it.
static class Engine
{
    public const string Version = "20.0.50";
    const int MaxErrorChars = 2000;
    static readonly TimeSpan Timeout = TimeSpan.FromSeconds(120);
    static string? exePath;

    public static string UnpackPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tokenscope", "engine", Version, "ccusage.exe");

    /// %LOCALAPPDATA%\Tokenscope\engine\20.0.50\ccusage.exe, written from the embedded resource if absent.
    public static string EnsureUnpacked()
    {
        var path = UnpackPath;
        if (!File.Exists(path))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            // Write to a temp name and move, so a crash never leaves a truncated exe at the final path.
            var tmp = $"{path}.{Environment.ProcessId}.tmp";
            using (var src = typeof(Engine).Assembly.GetManifestResourceStream("engine/ccusage.exe")
                ?? throw new InvalidOperationException("The engine is not embedded in this build."))
            using (var dst = File.Create(tmp))
                src.CopyTo(dst);
            File.Move(tmp, path, overwrite: true);
        }
        return exePath = path;
    }

    /// Strips BOM and anything before the first '{' or '['; null if none or invalid JSON.
    public static string? ExtractJson(string stdout)
    {
        var s = stdout.TrimStart('\uFEFF');
        int start = s.IndexOfAny(['{', '[']);
        if (start < 0) return null;
        s = s[start..].TrimEnd();
        try
        {
            using var _ = JsonDocument.Parse(s);
            return s;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// Runs `ccusage <args> --json`. payload = JSON on success, else error text (≤ 2000 chars).
    /// Cancelling ct (or the 120 s timeout) kills the process.
    public static async Task<(bool ok, string payload)> RunAsync(string[] args, CancellationToken ct)
    {
        var exe = exePath ?? EnsureUnpacked();
        var psi = new ProcessStartInfo(exe)
        {
            WorkingDirectory = Path.GetDirectoryName(exe),   // ccusage's config discovery must not depend on the launch directory
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.ArgumentList.Add("--json");

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("ccusage did not start");
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
        limit.CancelAfter(Timeout);
        // Registered on the token so the kill happens inside Cancel(), even while the app is exiting.
        // Catches everything: Kill can throw several types, and an exception here would be unhandled on a timer thread or escape OnFormClosing.
        using var kill = limit.Token.Register(() => { try { p.Kill(entireProcessTree: true); } catch (Exception) { } });

        var stdout = p.StandardOutput.ReadToEndAsync(CancellationToken.None);
        var stderr = p.StandardError.ReadToEndAsync(CancellationToken.None);
        try
        {
            await p.WaitForExitAsync(limit.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return (false, ct.IsCancellationRequested ? "cancelled" : $"ccusage timed out after {Timeout.TotalSeconds:0} s");
        }
        var output = await stdout.ConfigureAwait(false);
        var error = await stderr.ConfigureAwait(false);

        if (p.ExitCode != 0)
        {
            var text = (string.IsNullOrWhiteSpace(error) ? output : error).Trim();
            if (text.Length == 0) text = $"ccusage exited with code {p.ExitCode}";
            return (false, text.Length > MaxErrorChars ? text[..MaxErrorChars] : text);
        }
        return ExtractJson(output) is { } json ? (true, json) : (false, "ccusage returned unexpected output");
    }
}
