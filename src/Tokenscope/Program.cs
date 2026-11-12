using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;

namespace Tokenscope;

static class Program
{
    const string InstanceMutex = @"Local\Tokenscope.Instance";
    const string ActivateEvent = @"Local\Tokenscope.Activate";

    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int processId);

    [STAThread]
    static int Main(string[] args)
    {
        if (args is ["--selfcheck"]) return SelfCheck();

        using var mutex = new Mutex(true, InstanceMutex, out bool first);
        using var activate = new EventWaitHandle(false, EventResetMode.AutoReset, ActivateEvent);
        if (!first)
        {
            AllowSetForegroundWindow(-1);   // ASFW_ANY: let the running instance take the foreground
            activate.Set();
            return 0;
        }

        ApplicationConfiguration.Initialize();
        try
        {
            CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show("Tokenscope needs the Microsoft Edge WebView2 Runtime.\n\nDownload it from:\nhttps://developer.microsoft.com/microsoft-edge/webview2/",
                "Tokenscope", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        try
        {
            Engine.EnsureUnpacked();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Could not unpack the ccusage engine to:\n{Engine.UnpackPath}\n\n{ex.Message}",
                "Tokenscope", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        using var form = new MainForm();
        _ = form.Handle;   // so BeginInvoke works as soon as a second launch signals
        var wait = ThreadPool.RegisterWaitForSingleObject(activate, (_, _) =>
        {
            try { form.BeginInvoke(form.ShowAndActivate); }
            catch (InvalidOperationException) { }   // window already gone: we are exiting
        }, null, Timeout.Infinite, executeOnlyOnce: false);
        Application.Run(form);
        wait.Unregister(null);
        return 0;
    }

    // Exit code is the result (a WinExe has no console); failures also go to stderr.
    static int SelfCheck()
    {
        string?[] allowed = [
            ArgPolicy.Validate(["daily", "--sections", "daily,session", "--by-agent"]),
            ArgPolicy.Validate(["blocks", "--token-limit", "max"]),
            ArgPolicy.Validate(["claude", "daily", "--instances", "--timezone", "UTC"]),
            ArgPolicy.Validate(["daily", "--timezone", "America/New_York"]),
            ArgPolicy.Validate(["claude", "daily", "--project", "Y--Programs-Sample-App"]),
            ArgPolicy.Validate(["codex", "session", "--id", "2026/07/14/rollout-2026-07-14T20-04-40-019f634d"]),
            ArgPolicy.Validate(["daily", "--since", "20260101"]),
        ];
        for (int i = 0; i < allowed.Length; i++)
            if (allowed[i] != null) return Fail($"allowed case {i} rejected: {allowed[i]}");

        string[][] rejected = [
            [], ["statusline"], ["daily", "--config", "x.json"], ["notasource", "daily"],
            ["daily", "--json"], ["daily", "&", "calc"],
            // a value flag takes exactly one value: non-empty, not starting with '-'
            ["daily", "--project", "--config=x.json"], ["daily", "--since"], ["daily", "--since", ""],
            ["daily", "--since", "--until"],
            // values: [A-Za-z0-9._:,/+-]{1,200}, no "..", not starting with '/'
            ["claude", "session", "--id", "../../secret"], ["claude", "session", "--id", "a*"],
            ["daily", "--project", "a b"], ["daily", "--project", "C:\\x"], ["daily", "--timezone", "/etc/passwd"],
            ["daily", "--project", new string('a', 201)], ["daily", "--project", "a\n"],
        ];
        foreach (var a in rejected)
            if (ArgPolicy.Validate(a) == null) return Fail($"rejected case allowed: [{string.Join(' ', a)}]");

        (string input, string? expected)[] extract = [
            ("\uFEFF{\"a\":1}", "{\"a\":1}"),
            ("warning: x\n{\"a\":1}", "{\"a\":1}"),
            ("oops", null),
            ("{broken", null),
        ];
        foreach (var (input, expected) in extract)
        {
            var got = Engine.ExtractJson(input);
            if (got != expected) return Fail($"ExtractJson({input}) = {got ?? "null"}, expected {expected ?? "null"}");
        }
        if (MachineSync.SelfCheck() is { } syncFailure) return Fail("machine sync: " + syncFailure);
        return 0;
    }

    static int Fail(string message)
    {
        Console.Error.WriteLine("selfcheck FAILED: " + message);
        return 1;
    }
}
