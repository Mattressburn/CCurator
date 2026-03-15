# GPCRM Case Extractor Manual Test Checklist

## Route Gating

- Open a non-case Salesforce route and click popup actions.
- Confirm popup reports unsupported route.
- Open a case route: `/lightning/r/Case/<CASE_ID>/view`.
- Confirm scrape action proceeds.

## Stable DOM Wait

- Hard refresh case page.
- Trigger scrape immediately while page still rendering.
- Confirm extraction succeeds after dynamic content settles.

## Card Classification

- Confirm `Emails (n)` card is detected and parsed.
- Confirm `Activity History` content contributes to events.
- Confirm `Knowledge`, `Product Hierarchy`, and `Files` are ignored in v1 output.

## Data Extraction

- Verify case number is captured from page title/header.
- Verify emails summary includes `subject`, `from`, `to`, `date`.
- Verify events include `Email Message`, `Case Action`, `Case History`, `Escalation RFA` blocks.
- Expand an email body and verify `#contentpage_emailTemplateBodyContent` content is included.

## Dequote Cleanup

- Validate repeated quoted chains are removed after markers:
  - `--------------- Original Message ---------------`
  - `From:` `Sent:` `Subject:` `To:` `Cc:` `thread::`
- Confirm newest top-level email body remains.

## Translation Hook

- Use a Spanish event block and run scrape.
- Confirm `spanishDetected=true` on affected event.
- Confirm original text is preserved.
- Confirm `translatedText` is empty and `translationAvailable=false` when in-browser translation is unavailable.

## Output Actions

- Click `Copy JSON` and confirm clipboard contains full structured payload.
- Click `Copy AI Text` and confirm clipboard contains compact cleaned summary text.
- Click `Download JSON` and confirm case JSON file downloads.

## Logging

- Confirm normal mode logs are concise.
- Add `?ccdebug=1` to URL and repeat scrape.
- Confirm debug mode includes timing/selector diagnostics in console.