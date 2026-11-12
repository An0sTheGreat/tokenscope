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
    const long MaxBytes = 16 * 1024 * 1024;   // per snapshot; a real one is about 1 MB
    const int MaxFiles = 16;                  // ponytail: more machines than this are ignored

    static readonly string ConfigFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tokenscope", "sync.json");

    sealed record Config(string? Folder);

    static string OwnFile =>
        string.Concat(Environment.MachineName.Select(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' ? c : '_')) + Suffix;

    public static string? LoadFolder()
    {
        try { return JsonSerializer.Deserialize<Config>(File.ReadAllText(ConfigFile))?.Folder; }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return null; }
    }

    public static void SaveFolder(string? folder)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ConfigFile)!);
        File.WriteAllText(ConfigFile, JsonSerializer.Serialize(new Config(folder)));
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
            if (content != null)
            {
                if (Encoding.UTF8.GetByteCount(content) > MaxBytes || !IsJsonObject(content))
                    return (false, "snapshot is not a JSON object or is too large");
                // Write beside the target, then rename: a sync client must never upload half a file.
                var target = Path.Combine(folder, OwnFile);
                File.WriteAllText(target + ".tmp", content, new UTF8Encoding(false));
                File.Move(target + ".tmp", target, overwrite: true);
            }
            var others = new StringBuilder("[");
            var files = new DirectoryInfo(folder).EnumerateFiles("*" + Suffix, SearchOption.TopDirectoryOnly)
                .Where(f => f.Name.EndsWith(Suffix, StringComparison.OrdinalIgnoreCase)   // the pattern also matches longer extensions
                    && !f.Name.Equals(OwnFile, StringComparison.OrdinalIgnoreCase) && f.Length <= MaxBytes)
                .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase).Take(MaxFiles);
            foreach (var file in files)
            {
                try
                {
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
            File.WriteAllText(Path.Combine(dir, "Other-PC" + Suffix), "{\"v\":1}");
            File.WriteAllText(Path.Combine(dir, "broken" + Suffix), "{nope");
            File.WriteAllText(Path.Combine(dir, "notes.json"), "{\"v\":2}");
            if (Exchange(dir, "[1]").Ok) return "a non-object snapshot was accepted";
            var (ok, payload) = Exchange(dir, "{\"v\":1,\"own\":true}");
            if (!ok || payload != "[{\"v\":1}]") return $"unexpected exchange result: {ok} {payload}";
            if (!File.Exists(Path.Combine(dir, OwnFile)) || File.Exists(Path.Combine(dir, OwnFile + ".tmp"))) return "own snapshot was not written cleanly";
            if (Exchange(null, "{}").Payload != "[]" || Exchange(Path.Combine(dir, "missing"), null).Ok) return "off or missing folder was not handled";
            return null;
        }
        finally { Directory.Delete(dir, recursive: true); }
    }
}
