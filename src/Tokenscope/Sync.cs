using System.Text;
using System.Text.Json;

namespace Tokenscope;

/// Machine sync: each PC writes one usage snapshot into a folder the user picked (for example
/// inside a cloud drive) and reads the snapshots other PCs left there. The page never names a
/// path: the folder comes from a folder dialog and is remembered here, and only top-level
/// "*.tokenscope.json" files in it are ever read or written.
static class MachineSync
{
    const string Suffix = ".tokenscope.json";
    const long MaxBytes = 4 * 1024 * 1024;          // per snapshot; a real one is about 1 MB
    const long MaxTotalBytes = 32 * 1024 * 1024;    // all other PCs together, so junk cannot stall the UI
    const int MaxFiles = 16;                        // ponytail: more machines than this are ignored

    static readonly string ConfigFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tokenscope", "sync.json");

    // Machine and the three argument lists are the "recipe" the app last synced with, so a headless
    // --sync run (Task Scheduler) writes the same snapshot the app would.
    sealed record Config(string? Folder, string? Id, string? Machine = null, string[]? Main = null, string[]? Sessions = null, string[]? Projects = null);

    static Config Load()
    {
        try { return JsonSerializer.Deserialize<Config>(File.ReadAllText(ConfigFile)) ?? new(null, null); }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return new(null, null); }
    }

    static void Save(Config config)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ConfigFile)!);
        File.WriteAllText(ConfigFile, JsonSerializer.Serialize(config));
    }

    // A random id per install names this PC's file, so two PCs with the same Windows name never
    // share one, and a renamed PC keeps (and replaces) its own.
    // ponytail: the id lives in LocalAppData; wipe that and the old file stays behind as a stale PC to delete by hand.
    static readonly Lazy<string> Id = new(() =>
        Load().Id is { Length: 8 } id && id.All(char.IsAsciiHexDigit) ? id : Guid.NewGuid().ToString("N")[..8]);

    static string OwnTail => "-" + Id.Value + Suffix;
    static string OwnFile =>
        string.Concat(Environment.MachineName.Select(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' ? c : '_')) + OwnTail;

    public static string? LoadFolder() => Load().Folder;

    /// Throws when the setting cannot be stored; callers keep their previous folder in that case.
    public static void SaveFolder(string? folder) => Save(Load() with { Folder = folder, Id = Id.Value });

    /// Remembers what the app synced with. Argument lists that the policy rejects are ignored.
    public static void SaveRecipe(string? machine, string[]? main, string[]? sessions, string[]? projects)
    {
        static string[]? Allowed(string[]? args) => args is { Length: > 0 } && ArgPolicy.Validate(args) == null ? args : null;
        if (Allowed(main) == null) return;
        var name = string.Concat((machine ?? "").Where(c => !char.IsControl(c))).Trim();
        var next = Load() with { Id = Id.Value, Machine = name.Length > 40 ? name[..40] : name, Main = main, Sessions = Allowed(sessions), Projects = Allowed(projects) };
        try { Save(next); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }   // the next sync stores it
    }

    /// "Tokenscope.exe --sync": reads usage with the engine and writes this PC's snapshot to the
    /// sync folder without opening the window. Exit code 0 = written, 1 = failed, 2 = sync is off.
    public static async Task<int> RunHeadless()
    {
        var config = Load();
        if (string.IsNullOrEmpty(config.Folder)) { return Report(2, "no sync folder is set (choose one in Settings, Machines)"); }
        try
        {
            Engine.EnsureUnpacked();
            using var limit = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            static string[]? Allowed(string[]? args) => args is { Length: > 0 } && ArgPolicy.Validate(args) == null ? args : null;
            var main = Engine.RunAsync(Allowed(config.Main) ?? ["daily", "--sections", "daily,session", "--by-agent"], limit.Token);
            var sessions = Engine.RunAsync(Allowed(config.Sessions) ?? ["claude", "session"], limit.Token);
            var projects = Engine.RunAsync(Allowed(config.Projects) ?? ["claude", "daily", "--instances"], limit.Token);
            await Task.WhenAll(main, sessions, projects);
            if (!main.Result.ok) return Report(1, main.Result.payload);

            var buffer = new System.Buffers.ArrayBufferWriter<byte>();
            using (var w = new Utf8JsonWriter(buffer))
            {
                w.WriteStartObject();
                w.WriteNumber("v", 1);
                w.WriteString("machine", string.IsNullOrWhiteSpace(config.Machine) ? Environment.MachineName : config.Machine);
                w.WriteNumber("savedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                w.WriteStartObject("raw");
                w.WritePropertyName("main"); w.WriteRawValue(main.Result.payload, skipInputValidation: true);   // validated by ExtractJson
                w.WritePropertyName("sessions");
                if (sessions.Result.ok) w.WriteRawValue(sessions.Result.payload, skipInputValidation: true); else w.WriteNullValue();
                w.WritePropertyName("projects");
                if (projects.Result.ok) w.WriteRawValue(projects.Result.payload, skipInputValidation: true); else w.WriteRawValue("{\"projects\":{}}");
                w.WriteEndObject();
                w.WriteEndObject();
            }
            var (ok, payload) = Exchange(config.Folder, Encoding.UTF8.GetString(buffer.WrittenSpan));
            return ok ? Report(0, $"snapshot written to {config.Folder}") : Report(1, payload);
        }
        catch (Exception ex)   // unattended: every failure must end up in the log, never in a crash dialog
        {
            return Report(1, ex.GetType().Name + ": " + ex.Message);
        }
    }

    /// The last headless run, for whoever wonders why a scheduled sync did nothing:
    /// %LOCALAPPDATA%Tokenscopesync.log holds one line (time, exit code, what happened).
    static int Report(int code, string message)
    {
        var line = $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz} exit {code}: {message}";
        try { Directory.CreateDirectory(Path.GetDirectoryName(ConfigFile)!); File.WriteAllText(Path.Combine(Path.GetDirectoryName(ConfigFile)!, "sync.log"), line + Environment.NewLine); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        try { if (code != 0) Console.Error.WriteLine("sync: " + message); } catch (IOException) { }   // no console when scheduled
        return code;
    }

    public static string InfoJson(string? folder) =>
        JsonSerializer.Serialize(new { folder, machine = Environment.MachineName });

    /// Writes this PC's snapshot when content is given, then returns a JSON array of the other
    /// PCs' snapshots. Unreadable, oversized or non-JSON files are skipped.
    public static (bool Ok, string Payload) Exchange(string? folder, string? content)
    {
        if (string.IsNullOrEmpty(folder)) return (true, "[]");
        try
        {
            if (!Directory.Exists(folder)) return (false, $"The sync folder is not available: {folder}");
            bool Own(FileInfo f) => f.Name.EndsWith(OwnTail, StringComparison.OrdinalIgnoreCase);
            if (content != null)
            {
                if (Encoding.UTF8.GetByteCount(content) > MaxBytes || !IsJsonObject(content))
                    return (false, "snapshot is not a JSON object or is too large");
                // Write beside the target, then rename: a sync client must never upload half a file.
                var target = Path.Combine(folder, OwnFile);
                File.WriteAllText(target + ".tmp", content, new UTF8Encoding(false));
                File.Move(target + ".tmp", target, overwrite: true);
                // After a Windows rename this PC's old file would otherwise show up as a second PC.
                foreach (var old in new DirectoryInfo(folder).EnumerateFiles("*" + OwnTail).Where(f => Own(f) && !f.Name.Equals(OwnFile, StringComparison.OrdinalIgnoreCase)))
                    old.Delete();
            }
            var others = new StringBuilder("[");
            long budget = MaxTotalBytes;
            var files = new DirectoryInfo(folder).EnumerateFiles("*" + Suffix, SearchOption.TopDirectoryOnly)
                .Where(f => f.Name.EndsWith(Suffix, StringComparison.OrdinalIgnoreCase)   // the pattern also matches longer extensions
                    && !Own(f) && f.Length <= MaxBytes)
                .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase).Take(MaxFiles);
            foreach (var file in files)
            {
                try
                {
                    if ((budget -= file.Length) < 0) break;
                    var text = File.ReadAllText(file.FullName);
                    if (!IsJsonObject(text)) continue;
                    if (others.Length > 1) others.Append(',');
                    others.Append(text);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }   // locked or still downloading: next refresh
            }
            return (true, others.Append(']').ToString());
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return (false, $"Could not use the sync folder: {ex.Message}");
        }
    }

    static bool IsJsonObject(string text)
    {
        try { using var doc = JsonDocument.Parse(text); return doc.RootElement.ValueKind == JsonValueKind.Object; }
        catch (JsonException) { return false; }
    }

    /// Used by --selfcheck: null when the round trip works, else what failed.
    public static string? SelfCheck()
    {
        var dir = Directory.CreateTempSubdirectory("tokenscope-sync-").FullName;
        try
        {
            File.WriteAllText(Path.Combine(dir, "Other-PC-0a1b2c3d" + Suffix), "{\"v\":1}");
            File.WriteAllText(Path.Combine(dir, "broken" + Suffix), "{nope");
            File.WriteAllText(Path.Combine(dir, "huge" + Suffix), "{\"x\":\"" + new string('a', (int)MaxBytes) + "\"}");
            File.WriteAllText(Path.Combine(dir, "notes.json"), "{\"v\":2}");
            File.WriteAllText(Path.Combine(dir, "Old-Name" + OwnTail), "{\"v\":1,\"stale\":true}");   // this PC before a rename
            if (Exchange(dir, "[1]").Ok) return "a non-object snapshot was accepted";
            var (ok, payload) = Exchange(dir, "{\"v\":1,\"own\":true}");
            if (!ok || payload != "[{\"v\":1}]") return $"unexpected exchange result: {ok} {payload}";
            if (!File.Exists(Path.Combine(dir, OwnFile)) || File.Exists(Path.Combine(dir, OwnFile + ".tmp"))) return "own snapshot was not written cleanly";
            if (File.Exists(Path.Combine(dir, "Old-Name" + OwnTail))) return "this PC's file from before a rename was left behind";
            if (Exchange(null, "{}").Payload != "[]" || Exchange(Path.Combine(dir, "missing"), null).Ok) return "off or missing folder was not handled";
            return null;
        }
        finally { Directory.Delete(dir, recursive: true); }
    }
}
