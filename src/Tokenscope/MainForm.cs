using System.Buffers;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace Tokenscope;

/// The dashboard window: WebView2 serving the embedded UI, the JS bridge, and the tray icon.
sealed class MainForm : Form
{
    const string Origin = "https://app.tokenscope/";
    const string AppTitle = "Tokenscope";
    // Inline script/style stay allowed (the design gallery uses them); nothing may load from or connect outside the app origin.
    const string Csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

    static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tokenscope");
    static readonly string PlacementFile = Path.Combine(DataDir, "window.json");
    static readonly string TrayHintFile = Path.Combine(DataDir, "tray-hint-shown");

    static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".js"] = "text/javascript; charset=utf-8",
        [".svg"] = "image/svg+xml",
        [".json"] = "application/json; charset=utf-8",
    };

    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    readonly NotifyIcon tray = new();
    readonly CancellationTokenSource lifetime = new();   // cancelled on exit: kills running engines
    bool closeToTray = true;
    bool quitting;
    string theme = "system";
    string? syncFolder = MachineSync.LoadFolder();   // null: machine sync is off

    public MainForm()
    {
        Text = AppTitle;
        // From the embedded .ico (all frames), so each consumer can pick its size; ExtractAssociatedIcon yields only 32 px.
        using (var ico = typeof(MainForm).Assembly.GetManifestResourceStream("app.ico")!)
            Icon = new Icon(ico);
        MinimumSize = LogicalToDeviceUnits(new Size(960, 640));
        Size = LogicalToDeviceUnits(new Size(1280, 820));
        StartPosition = FormStartPosition.CenterScreen;
        RestorePlacement();
        ApplyTheme();
        Controls.Add(web);

        tray.Icon = new Icon(Icon, SystemInformation.SmallIconSize);
        tray.Text = AppTitle;
        tray.ContextMenuStrip = new ContextMenuStrip();
        tray.ContextMenuStrip.Items.Add("Open", null, (_, _) => ShowAndActivate());
        tray.ContextMenuStrip.Items.Add("Refresh now", null, (_, _) => web.CoreWebView2?.PostWebMessageAsJson("{\"type\":\"refresh\"}"));
        tray.ContextMenuStrip.Items.Add("Quit", null, (_, _) => { quitting = true; Close(); });
        tray.MouseClick += (_, e) =>
        {
            if (e.Button != MouseButtons.Left) return;
            if (Visible && WindowState != FormWindowState.Minimized) Hide(); else ShowAndActivate();
        };
        tray.Visible = true;
    }

    public void ShowAndActivate()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "webview"));
            if (Gone) return;
            await web.EnsureCoreWebView2Async(env);
            if (Gone) return;
        }
        catch (Exception ex)
        {
            if (Gone) return;   // closed (e.g. Quit from the tray) while starting: nothing to report
            MessageBox.Show(this, $"WebView2 could not start.\n\n{ex.Message}", AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            quitting = true;
            Close();
            return;
        }
        var core = web.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += ServeEmbedded;
        EventHandler<CoreWebView2NavigationStartingEventArgs> appOriginOnly = (_, a) => { if (!a.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) a.Cancel = true; };
        core.NavigationStarting += appOriginOnly;
        core.FrameNavigationStarting += appOriginOnly;
        core.NewWindowRequested += (_, a) => a.Handled = true;   // no new windows, whatever the origin
        core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? AppTitle : core.DocumentTitle;
        core.WebMessageReceived += OnWebMessage;
        core.Navigate(Origin + "index.html");
    }

    // The window was closed or disposed while an await was pending.
    bool Gone => IsDisposed || lifetime.IsCancellationRequested;

    void ServeEmbedded(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var path = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath.TrimStart('/'));
        var stream = Mime.TryGetValue(Path.GetExtension(path), out var mime)
            ? typeof(MainForm).Assembly.GetManifestResourceStream("ui/" + path) : null;
        var env = web.CoreWebView2.Environment;
        e.Response = stream is null
            ? env.CreateWebResourceResponse(null, 404, "Not Found", "")
            : env.CreateWebResourceResponse(stream, 200, "OK", "Content-Type: " + mime +
                (mime!.StartsWith("text/html", StringComparison.Ordinal) ? "\r\nContent-Security-Policy: " + Csp : ""));
    }

    // Bridge: page posts {id, type, ...}; host replies {id, ok, data?, error?, path?}. Every request gets a reply.
    // Types: run, save, tray, openExternal, and machine sync (syncInfo, syncPick, syncOff, sync; see Sync.cs).
    async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement id = default;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var msg = doc.RootElement;
            if (msg.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("request must be an object");
            if (msg.TryGetProperty("id", out var i)) id = i.Clone();
            var type = msg.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
            switch (type)
            {
                case "run":
                    var args = msg.GetProperty("args").Deserialize<string[]>() ?? [];
                    if (ArgPolicy.Validate(args) is { } reason) { Reply(id, false, error: reason); return; }
                    var (ok, payload) = await Task.Run(() => Engine.RunAsync(args, lifetime.Token));
                    if (ok) Reply(id, true, data: payload); else Reply(id, false, error: payload);
                    break;
                case "save":
                    Save(id, Str(msg, "name") ?? "export.txt", Str(msg, "content") ?? "");
                    break;
                case "tray":
                    if (Str(msg, "text") is { } text) tray.Text = text.Length > 127 ? text[..127] : text;
                    if (msg.TryGetProperty("closeToTray", out var c) && c.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        closeToTray = c.GetBoolean();
                    if (Str(msg, "theme") is "light" or "dark" or "system") { theme = Str(msg, "theme")!; ApplyTheme(); }
                    Reply(id, true);
                    break;
                case "syncInfo":
                    Reply(id, true, data: MachineSync.InfoJson(syncFolder));
                    break;
                case "syncPick":
                    using (var pick = new FolderBrowserDialog
                    {
                        Description = "Choose the folder Tokenscope syncs through, for example one inside Google Drive",
                        UseDescriptionForTitle = true, InitialDirectory = syncFolder ?? "",
                    })
                        if (pick.ShowDialog(this) == DialogResult.OK) SetSyncFolder(pick.SelectedPath);
                    Reply(id, true, data: MachineSync.InfoJson(syncFolder));
                    break;
                case "syncOff":
                    SetSyncFolder(null);
                    Reply(id, true, data: MachineSync.InfoJson(syncFolder));
                    break;
                case "sync":
                    // the app also says how it built the snapshot, so "Tokenscope.exe --sync" can repeat it unattended
                    if (msg.TryGetProperty("recipe", out var recipe) && recipe.ValueKind == JsonValueKind.Object && recipe.TryGetProperty("args", out var recipeArgs) && recipeArgs.ValueKind == JsonValueKind.Object)
                    {
                        string[]? List(string name) => recipeArgs.TryGetProperty(name, out var a) && a.ValueKind == JsonValueKind.Array && a.EnumerateArray().All(x => x.ValueKind == JsonValueKind.String) ? a.Deserialize<string[]>() : null;
                        MachineSync.SaveRecipe(Str(recipe, "machine"), List("main"), List("sessions"), List("projects"));
                    }
                    var (folder, snapshot) = (syncFolder, Str(msg, "content"));
                    var (synced, others) = await Task.Run(() => MachineSync.Exchange(folder, snapshot));
                    if (synced) Reply(id, true, data: others); else Reply(id, false, error: others);
                    break;
                case "openExternal":
                    if (Uri.TryCreate(Str(msg, "url"), UriKind.Absolute, out var url) && url.Scheme == Uri.UriSchemeHttps)
                    {
                        Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true })?.Dispose();
                        Reply(id, true);
                    }
                    else Reply(id, false, error: "only https:// URLs can be opened");
                    break;
                default:
                    Reply(id, false, error: "unknown request");
                    break;
            }
        }
        catch (Exception ex)
        {
            Reply(id, false, error: ex.Message);
        }
    }

    // Stored before it takes effect, so memory, the page and the next start can never disagree.
    // If it cannot be stored the folder stays as it was and the page is told the current state.
    void SetSyncFolder(string? folder)
    {
        try { MachineSync.SaveFolder(folder); syncFolder = folder; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    static string? Str(JsonElement msg, string name) =>
        msg.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    void Save(JsonElement id, string name, string content)
    {
        name = Path.GetFileName(name);
        var ext = Path.GetExtension(name);
        using var dialog = new SaveFileDialog
        {
            FileName = name,
            Filter = ext.Length > 1 ? $"{ext[1..].ToUpperInvariant()} file|*{ext}|All files|*.*" : "All files|*.*",
            OverwritePrompt = true,
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) { Reply(id, false, error: "cancelled"); return; }
        File.WriteAllText(dialog.FileName, content, new UTF8Encoding(false));
        Reply(id, true, path: dialog.FileName);
    }

    void Reply(JsonElement id, bool ok, string? data = null, string? error = null, string? path = null)
    {
        if (IsDisposed || web.CoreWebView2 is null) return;   // reply arrived after the window closed
        var buffer = new ArrayBufferWriter<byte>();
        using (var w = new Utf8JsonWriter(buffer))
        {
            w.WriteStartObject();
            w.WritePropertyName("id");
            if (id.ValueKind == JsonValueKind.Undefined) w.WriteNullValue(); else id.WriteTo(w);
            w.WriteBoolean("ok", ok);
            if (data != null) { w.WritePropertyName("data"); w.WriteRawValue(data, skipInputValidation: true); }   // validated by ExtractJson
            if (error != null) w.WriteString("error", error);
            if (path != null) w.WriteString("path", path);
            w.WriteEndObject();
        }
        web.CoreWebView2.PostWebMessageAsJson(Encoding.UTF8.GetString(buffer.WrittenSpan));
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing && closeToTray && !quitting)
        {
            e.Cancel = true;
            Hide();
            ShowTrayHintOnce();
            return;
        }
        SavePlacement();
        lifetime.Cancel();
        tray.Visible = false;
        base.OnFormClosing(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { tray.Dispose(); lifetime.Dispose(); }
        base.Dispose(disposing);
    }

    void ShowTrayHintOnce()
    {
        if (File.Exists(TrayHintFile)) return;
        tray.ShowBalloonTip(5000, "Tokenscope is still running", "It keeps the tray meter up to date. Right-click the icon to quit.", ToolTipIcon.Info);
        try
        {
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(TrayHintFile, "");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }   // the hint shows again next time
    }

    // ---- window placement ----

    sealed record Placement(int X, int Y, int Width, int Height, bool Maximized);

    void RestorePlacement()
    {
        try
        {
            var p = JsonSerializer.Deserialize<Placement>(File.ReadAllText(PlacementFile));
            if (p is null) return;
            var r = new Rectangle(p.X, p.Y, p.Width, p.Height);
            if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r))) return;   // monitor gone
            StartPosition = FormStartPosition.Manual;
            Bounds = r;
            if (p.Maximized) WindowState = FormWindowState.Maximized;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { }   // first run or unreadable: defaults
    }

    void SavePlacement()
    {
        try
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(PlacementFile, JsonSerializer.Serialize(new Placement(r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized)));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    // ---- theme ----

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    const int DWMWA_BORDER_COLOR = 34, DWMWA_CAPTION_COLOR = 35, DWMWA_TEXT_COLOR = 36;   // Windows 11; ignored on Windows 10

    static bool SystemIsDark() =>
        Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) is 0;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyTheme();
    }

    // Title bar and background (shown before the page paints) follow the theme: Windows' app theme unless the UI overrides it.
    // The colours are --color-bg-grouped and --color-label from ui/design/tokens.css, so the title bar
    // is one surface with the page instead of a Windows-coloured strip above it.
    void ApplyTheme()
    {
        bool dark = theme == "dark" || (theme == "system" && SystemIsDark());
        BackColor = dark ? Color.Black : Color.FromArgb(0xF2, 0xF2, 0xF7);
        web.DefaultBackgroundColor = BackColor;
        if (!IsHandleCreated) return;
        int on = dark ? 1 : 0;
        DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
        int surface = ColorTranslator.ToWin32(BackColor), label = ColorTranslator.ToWin32(dark ? Color.White : Color.Black);
        DwmSetWindowAttribute(Handle, DWMWA_CAPTION_COLOR, ref surface, sizeof(int));
        DwmSetWindowAttribute(Handle, DWMWA_BORDER_COLOR, ref surface, sizeof(int));
        DwmSetWindowAttribute(Handle, DWMWA_TEXT_COLOR, ref label, sizeof(int));
    }
}
