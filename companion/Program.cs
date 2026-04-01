using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddPolicy("LocalExtensionDev", policy =>
    {
        policy
            .AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors("LocalExtensionDev");

var intakeRoot = Path.Combine(AppContext.BaseDirectory, "intake");
Directory.CreateDirectory(intakeRoot);

app.MapGet("/health", () => Results.Json(new
{
    ok = true,
    service = "gpcrm-companion",
    utc = DateTime.UtcNow.ToString("o")
}));

app.MapPost("/workflow/case", async (HttpRequest req, HttpResponse res) =>
{
    res.ContentType = "application/json";
    res.Headers.CacheControl = "no-store";

    var requestOrigin = req.Headers.Origin.ToString();

    try
    {
        string rawBody;
        using (var reader = new StreamReader(req.Body, Encoding.UTF8))
        {
            rawBody = await reader.ReadToEndAsync();
        }

        if (string.IsNullOrWhiteSpace(rawBody))
        {
            await WriteJson(res, 400, new AckResponse
            {
                Ok = false,
                Type = "gpcrm.case.intake.ack",
                SchemaVersion = 2,
                Code = "EMPTY_BODY",
                Message = "Request body is empty"
            });
            return;
        }

        using var doc = JsonDocument.Parse(rawBody);
        var root = doc.RootElement;

        var normalized = NormalizeIncoming(root);
        if (!normalized.Ok)
        {
            await WriteJson(res, 400, new AckResponse
            {
                Ok = false,
                Type = "gpcrm.case.intake.ack",
                SchemaVersion = 2,
                HandoffId = normalized.HandoffId,
                Code = "HANDOFF_VALIDATION_FAILED",
                Message = "Payload failed validation",
                Errors = normalized.Errors,
                Warnings = normalized.Warnings,
                RequestOrigin = string.IsNullOrWhiteSpace(requestOrigin) ? null : requestOrigin
            });
            return;
        }

        var safeCaseNumber = SafePathSegment(normalized.CaseNumber);
        var safeFolderStem = SafePathSegment(normalized.FolderStem);
        var safeJobId = SafePathSegment(normalized.HandoffId);

        var jobFolder = Path.Combine(intakeRoot, safeCaseNumber, $"{safeFolderStem}_{safeJobId}");
        Directory.CreateDirectory(jobFolder);

        var rawJsonPath = Path.Combine(jobFolder, "raw.json");
        var normalizedPath = Path.Combine(jobFolder, "job.json");
        var metaPath = Path.Combine(jobFolder, "meta.json");

        var duplicate = File.Exists(rawJsonPath) && File.Exists(normalizedPath);

        if (!File.Exists(rawJsonPath))
        {
            await File.WriteAllTextAsync(rawJsonPath, rawBody, Encoding.UTF8);
        }

        if (!File.Exists(normalizedPath))
        {
            var normalizedJob = new
            {
                schemaVersion = 2,
                handoffId = normalized.HandoffId,
                receivedAtUtc = DateTime.UtcNow.ToString("o"),
                compatibilityMode = normalized.CompatibilityMode,
                requestType = normalized.RequestType,
                workflow = normalized.Workflow,

                source = !string.IsNullOrWhiteSpace(normalized.Source) ? normalized.Source : null,
                sourceObject = normalized.SourceObject,
                sourceApp = normalized.SourceApp,
                sourceVersion = normalized.SourceVersion,
                sourceBrowser = normalized.SourceBrowser,

                origin = normalized.Origin,
                trigger = normalized.Trigger,
                pageUrl = normalized.PageUrl,
                pageTitle = normalized.PageTitle,
                visibleCaseNumberHint = normalized.VisibleCaseNumberHint,
                exportedAt = normalized.ExportedAt,
                createdAtUtc = normalized.CreatedAtUtc,
                sentAtUtc = normalized.SentAtUtc,

                caseNumber = normalized.CaseNumber,
                folderStem = normalized.FolderStem,
                customerName = normalized.CustomerName,
                endUserName = normalized.EndUserName,
                integratorName = normalized.IntegratorName,
                siteName = normalized.SiteName,
                locationName = normalized.LocationName,
                contactName = normalized.ContactName,
                contactEmail = normalized.ContactEmail,
                region = normalized.Region,
                primaryProduct = normalized.PrimaryProduct,
                productVersion = normalized.ProductVersion,
                issueStatement = normalized.IssueStatement,
                issueDetails = normalized.IssueDetails,
                subjectLine = normalized.SubjectLine,

                events = normalized.Events,
                caseHistory = normalized.CaseHistory,
                escalation = normalized.Escalation,
                emailsSummary = normalized.EmailsSummary,
                extractionContext = normalized.ExtractionContext
            };

            await File.WriteAllTextAsync(
                normalizedPath,
                JsonSerializer.Serialize(normalizedJob, JsonOptions.Pretty),
                Encoding.UTF8);
        }

        var meta = new
        {
            receivedAtUtc = DateTime.UtcNow.ToString("o"),
            handoffId = normalized.HandoffId,
            caseNumber = normalized.CaseNumber,
            folderStem = normalized.FolderStem,
            duplicate = duplicate,
            requestOrigin = string.IsNullOrWhiteSpace(requestOrigin) ? null : requestOrigin,
            compatibilityMode = normalized.CompatibilityMode
        };

        await File.WriteAllTextAsync(
            metaPath,
            JsonSerializer.Serialize(meta, JsonOptions.Pretty),
            Encoding.UTF8);

        var response = new AckResponse
        {
            Ok = true,
            Type = "gpcrm.case.intake.ack",
            SchemaVersion = 2,
            HandoffId = normalized.HandoffId,
            JobId = normalized.HandoffId,
            RawJsonPath = rawJsonPath,
            NormalizedPath = normalizedPath,
            Duplicate = duplicate,
            Message = duplicate
                ? "Payload already ingested for this handoffId"
                : "Payload received and saved successfully",
            Warnings = normalized.Warnings,
            RequestOrigin = string.IsNullOrWhiteSpace(requestOrigin) ? null : requestOrigin,
            ReceivedAtUtc = DateTime.UtcNow.ToString("o")
        };

        try
        {
            Console.WriteLine(
                "[Companion] originHeader={0} handoffId={1} case={2} folderStem={3} duplicate={4} rawJsonPath={5}",
                string.IsNullOrWhiteSpace(requestOrigin) ? "(none)" : requestOrigin,
                normalized.HandoffId,
                normalized.CaseNumber,
                normalized.FolderStem,
                duplicate,
                rawJsonPath
            );
        }
        catch
        {
            // Console output should never fail the request
        }

        await WriteJson(res, 200, response);
    }
    catch (JsonException jex)
    {
        await WriteJson(res, 400, new AckResponse
        {
            Ok = false,
            Type = "gpcrm.case.intake.ack",
            SchemaVersion = 2,
            Code = "INVALID_JSON",
            Message = jex.Message,
            RequestOrigin = string.IsNullOrWhiteSpace(requestOrigin) ? null : requestOrigin
        });
    }
    catch (Exception ex)
    {
        await WriteJson(res, 500, new AckResponse
        {
            Ok = false,
            Type = "gpcrm.case.intake.ack",
            SchemaVersion = 2,
            Code = "SERVER_ERROR",
            Message = ex.Message,
            RequestOrigin = string.IsNullOrWhiteSpace(requestOrigin) ? null : requestOrigin
        });
    }
});

app.Run("http://127.0.0.1:38455");

static NormalizedIntake NormalizeIncoming(JsonElement root)
{
    var result = new NormalizedIntake();

    result.RequestType = GetString(root, "type");
    result.Workflow = GetString(root, "workflow");
    result.Origin = GetString(root, "origin");
    result.Trigger = GetString(root, "trigger");
    result.PageUrl = GetString(root, "pageUrl");
    result.PageTitle = GetString(root, "pageTitle");
    result.VisibleCaseNumberHint = GetString(root, "visibleCaseNumberHint");
    result.ExportedAt = GetString(root, "exportedAt");
    result.CreatedAtUtc = GetString(root, "createdAtUtc");
    result.SentAtUtc = GetString(root, "sentAtUtc");

    result.SchemaVersionRaw = FirstNonEmpty(
        GetStringOrNumber(root, "schemaVersion")
    );

    result.HandoffId = FirstNonEmpty(
        GetString(root, "handoffId"),
        GetString(root, "correlationId")
    );

    ReadSource(root, result);

    JsonElement payloadSource = root;
    if (root.TryGetProperty("payload", out var payloadElem) && payloadElem.ValueKind == JsonValueKind.Object)
    {
        payloadSource = payloadElem;

        if (string.IsNullOrWhiteSpace(result.SchemaVersionRaw))
        {
            result.SchemaVersionRaw = GetStringOrNumber(payloadSource, "schemaVersion");
        }

        if (string.IsNullOrWhiteSpace(result.HandoffId))
        {
            result.HandoffId = FirstNonEmpty(
                GetString(payloadSource, "handoffId"),
                GetString(payloadSource, "correlationId")
            );
        }

        if (string.IsNullOrWhiteSpace(result.RequestType))
            result.RequestType = GetString(payloadSource, "type");
        if (string.IsNullOrWhiteSpace(result.Workflow))
            result.Workflow = GetString(payloadSource, "workflow");
        if (string.IsNullOrWhiteSpace(result.Origin))
            result.Origin = GetString(payloadSource, "origin");
        if (string.IsNullOrWhiteSpace(result.Trigger))
            result.Trigger = GetString(payloadSource, "trigger");
        if (string.IsNullOrWhiteSpace(result.PageUrl))
            result.PageUrl = GetString(payloadSource, "pageUrl");
        if (string.IsNullOrWhiteSpace(result.PageTitle))
            result.PageTitle = GetString(payloadSource, "pageTitle");
        if (string.IsNullOrWhiteSpace(result.VisibleCaseNumberHint))
            result.VisibleCaseNumberHint = GetString(payloadSource, "visibleCaseNumberHint");
        if (string.IsNullOrWhiteSpace(result.ExportedAt))
            result.ExportedAt = GetString(payloadSource, "exportedAt");
        if (string.IsNullOrWhiteSpace(result.CreatedAtUtc))
            result.CreatedAtUtc = GetString(payloadSource, "createdAtUtc");
        if (string.IsNullOrWhiteSpace(result.SentAtUtc))
            result.SentAtUtc = GetString(payloadSource, "sentAtUtc");

        if (string.IsNullOrWhiteSpace(result.Source) && result.SourceObject is null)
        {
            ReadSource(payloadSource, result);
        }
    }

    JsonElement caseElem = default;
    var hasCaseObject =
        payloadSource.ValueKind == JsonValueKind.Object &&
        payloadSource.TryGetProperty("case", out caseElem) &&
        caseElem.ValueKind == JsonValueKind.Object;

    result.CompatibilityMode = hasCaseObject ? "legacy-case-envelope" : "flat-payload";

    result.CaseNumber = FirstNonEmpty(
        GetString(caseElem, "caseNumber"),
        GetString(payloadSource, "caseNumber"));

    result.FolderStem = FirstNonEmpty(
        GetString(caseElem, "folderStem"),
        GetString(payloadSource, "folderStem"));

    result.CustomerName = FirstNonEmpty(
        GetString(caseElem, "customerName"),
        GetString(payloadSource, "customerName"));

    result.EndUserName = FirstNonEmpty(
        GetString(caseElem, "endUserName"),
        GetString(payloadSource, "endUserName"));

    result.IntegratorName = FirstNonEmpty(
        GetString(caseElem, "integratorName"),
        GetString(payloadSource, "integratorName"));

    result.SiteName = FirstNonEmpty(
        GetString(caseElem, "siteName"),
        GetString(payloadSource, "siteName"));

    result.LocationName = FirstNonEmpty(
        GetString(caseElem, "locationName"),
        GetString(payloadSource, "locationName"));

    result.ContactName = FirstNonEmpty(
        GetString(caseElem, "contactName"),
        GetString(payloadSource, "contactName"));

    result.ContactEmail = FirstNonEmpty(
        GetString(caseElem, "contactEmail"),
        GetString(payloadSource, "contactEmail"));

    result.Region = FirstNonEmpty(
        GetString(caseElem, "region"),
        GetString(payloadSource, "region"));

    result.PrimaryProduct = FirstNonEmpty(
        GetString(caseElem, "primaryProduct"),
        GetString(payloadSource, "primaryProduct"));

    result.ProductVersion = FirstNonEmpty(
        GetString(caseElem, "productVersion"),
        GetString(payloadSource, "productVersion"));

    result.IssueStatement = FirstNonEmpty(
        GetString(caseElem, "issueStatement"),
        GetString(payloadSource, "issueStatement"));

    result.IssueDetails = FirstNonEmpty(
        GetString(caseElem, "issueDetails"),
        GetString(payloadSource, "issueDetails"));

    result.SubjectLine = FirstNonEmpty(
        GetString(caseElem, "subjectLine"),
        GetString(payloadSource, "subjectLine"));

    result.Events = CloneArray(payloadSource, "events");
    result.CaseHistory = CloneArray(payloadSource, "caseHistory");
    result.Escalation = CloneArray(payloadSource, "escalation");
    result.EmailsSummary = CloneArray(payloadSource, "emailsSummary");
    result.ExtractionContext = CloneObject(payloadSource, "extractionContext");

    Validate(result);
    return result;
}

static void ReadSource(JsonElement obj, NormalizedIntake result)
{
    if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty("source", out var sourceProp))
        return;

    if (sourceProp.ValueKind == JsonValueKind.String)
    {
        result.Source = sourceProp.GetString() ?? "";
        return;
    }

    if (sourceProp.ValueKind == JsonValueKind.Object)
    {
        result.SourceObject = CloneElement(sourceProp);
        result.SourceApp = GetString(sourceProp, "app");
        result.SourceVersion = GetString(sourceProp, "version");
        result.SourceBrowser = GetString(sourceProp, "browser");
    }
}

static void Validate(NormalizedIntake result)
{
    if (!SchemaVersionSupported(result.SchemaVersionRaw))
    {
        result.Errors.Add(new FieldError("schemaVersion", "schemaVersion must be 2"));
    }

    if (string.IsNullOrWhiteSpace(result.HandoffId))
    {
        result.Errors.Add(new FieldError("handoffId|correlationId", "handoffId or correlationId is required"));
    }

    if (string.IsNullOrWhiteSpace(result.CaseNumber))
    {
        result.Errors.Add(new FieldError("caseNumber", "caseNumber is required"));
    }

    if (string.IsNullOrWhiteSpace(result.FolderStem))
    {
        result.Errors.Add(new FieldError("folderStem", "folderStem is required"));
    }

    if (string.IsNullOrWhiteSpace(result.CustomerName) && string.IsNullOrWhiteSpace(result.EndUserName))
    {
        result.Errors.Add(new FieldError("customerName|endUserName", "Either customerName or endUserName is required"));
    }

    if (string.IsNullOrWhiteSpace(result.PrimaryProduct))
    {
        result.Errors.Add(new FieldError("primaryProduct", "primaryProduct is required"));
    }

    if (string.IsNullOrWhiteSpace(result.IssueStatement))
    {
        result.Errors.Add(new FieldError("issueStatement", "issueStatement is required"));
    }

    if (string.IsNullOrWhiteSpace(result.ContactEmail))
    {
        result.Warnings.Add("missing contactEmail");
    }

    if (string.IsNullOrWhiteSpace(result.Origin))
    {
        result.Warnings.Add("missing origin");
    }

    if (string.IsNullOrWhiteSpace(result.Trigger))
    {
        result.Warnings.Add("missing trigger");
    }

    result.Ok = result.Errors.Count == 0;
}

static bool SchemaVersionSupported(string value)
{
    var v = Clean(value);
    return v == "2" || v == "2.0";
}

static JsonElement CloneArray(JsonElement obj, string propertyName)
{
    if (obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(propertyName, out var prop) &&
        prop.ValueKind == JsonValueKind.Array)
    {
        return CloneElement(prop);
    }

    using var emptyDoc = JsonDocument.Parse("[]");
    return emptyDoc.RootElement.Clone();
}

static JsonElement CloneObject(JsonElement obj, string propertyName)
{
    if (obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(propertyName, out var prop) &&
        prop.ValueKind == JsonValueKind.Object)
    {
        return CloneElement(prop);
    }

    using var emptyDoc = JsonDocument.Parse("{}");
    return emptyDoc.RootElement.Clone();
}

static JsonElement CloneElement(JsonElement element)
{
    using var cloneDoc = JsonDocument.Parse(element.GetRawText());
    return cloneDoc.RootElement.Clone();
}

static string GetString(JsonElement obj, string propertyName)
{
    if (obj.ValueKind != JsonValueKind.Object) return "";
    if (!obj.TryGetProperty(propertyName, out var prop)) return "";

    return prop.ValueKind switch
    {
        JsonValueKind.String => prop.GetString() ?? "",
        JsonValueKind.Number => prop.ToString(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => ""
    };
}

static string GetStringOrNumber(JsonElement obj, string propertyName)
{
    if (obj.ValueKind != JsonValueKind.Object) return "";
    if (!obj.TryGetProperty(propertyName, out var prop)) return "";

    return prop.ValueKind switch
    {
        JsonValueKind.String => prop.GetString() ?? "",
        JsonValueKind.Number => prop.ToString(),
        _ => ""
    };
}

static string FirstNonEmpty(params string[] values)
{
    foreach (var value in values)
    {
        var cleaned = Clean(value);
        if (!string.IsNullOrWhiteSpace(cleaned))
            return cleaned;
    }

    return "";
}

static string Clean(string? value)
{
    if (string.IsNullOrWhiteSpace(value))
        return "";

    return Regex.Replace(value.Trim(), @"\s+", " ");
}

static string SafePathSegment(string? value)
{
    var cleaned = Clean(value);
    if (string.IsNullOrWhiteSpace(cleaned))
        return "unnamed";

    var invalidChars = Path.GetInvalidFileNameChars();
    var sb = new StringBuilder(cleaned.Length);

    foreach (var ch in cleaned)
    {
        sb.Append(Array.IndexOf(invalidChars, ch) >= 0 ? '_' : ch);
    }

    var result = sb.ToString().Trim().Trim('.');
    return string.IsNullOrWhiteSpace(result) ? "unnamed" : result;
}

static async Task WriteJson(HttpResponse res, int statusCode, object payload)
{
    res.StatusCode = statusCode;
    await res.WriteAsync(JsonSerializer.Serialize(payload, JsonOptions.Pretty));
}

static class JsonOptions
{
    public static readonly JsonSerializerOptions Pretty = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}

sealed class NormalizedIntake
{
    public bool Ok { get; set; }

    public string SchemaVersionRaw { get; set; } = "";
    public string HandoffId { get; set; } = "";
    public string RequestType { get; set; } = "";
    public string Workflow { get; set; } = "";

    public string Source { get; set; } = "";
    public JsonElement? SourceObject { get; set; }
    public string SourceApp { get; set; } = "";
    public string SourceVersion { get; set; } = "";
    public string SourceBrowser { get; set; } = "";

    public string Origin { get; set; } = "";
    public string Trigger { get; set; } = "";
    public string PageUrl { get; set; } = "";
    public string PageTitle { get; set; } = "";
    public string VisibleCaseNumberHint { get; set; } = "";
    public string ExportedAt { get; set; } = "";
    public string CreatedAtUtc { get; set; } = "";
    public string SentAtUtc { get; set; } = "";
    public string CompatibilityMode { get; set; } = "";

    public string CaseNumber { get; set; } = "";
    public string FolderStem { get; set; } = "";
    public string CustomerName { get; set; } = "";
    public string EndUserName { get; set; } = "";
    public string IntegratorName { get; set; } = "";
    public string SiteName { get; set; } = "";
    public string LocationName { get; set; } = "";
    public string ContactName { get; set; } = "";
    public string ContactEmail { get; set; } = "";
    public string Region { get; set; } = "";
    public string PrimaryProduct { get; set; } = "";
    public string ProductVersion { get; set; } = "";
    public string IssueStatement { get; set; } = "";
    public string IssueDetails { get; set; } = "";
    public string SubjectLine { get; set; } = "";

    public JsonElement Events { get; set; }
    public JsonElement CaseHistory { get; set; }
    public JsonElement Escalation { get; set; }
    public JsonElement EmailsSummary { get; set; }
    public JsonElement ExtractionContext { get; set; }

    public List<FieldError> Errors { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
}

sealed class AckResponse
{
    public bool Ok { get; set; }
    public string Type { get; set; } = "gpcrm.case.intake.ack";
    public int SchemaVersion { get; set; } = 2;
    public string? HandoffId { get; set; }
    public string? JobId { get; set; }
    public string? RawJsonPath { get; set; }
    public string? NormalizedPath { get; set; }
    public bool Duplicate { get; set; }
    public string? Code { get; set; }
    public string? Message { get; set; }
    public string? RequestOrigin { get; set; }
    public string? ReceivedAtUtc { get; set; }
    public List<FieldError>? Errors { get; set; }
    public List<string>? Warnings { get; set; }
}

sealed record FieldError(string Field, string Message);