Case Ingestor (formerly CaseCleaner / CCurator) is a specialized Chrome extension built to extract, normalize, deduplicate, and package Salesforce Lightning case activity for seamless Large Language Model (LLM) handoff.

Designed specifically for Technical Support Escalation Engineers, this tool pierces through Salesforce's complex Lightning Web Components (LWC) and Shadow DOMs to scrape case histories, strip out noisy email quotes, and generate highly targeted AI prompts for tools like ChatGPT, Claude, Atlassian Rovo, and Copilot Researcher.
✨ Key Features

    Deep Salesforce Scraping: Bypasses Salesforce's Shadow DOM restrictions to extract hidden text from Emails, Case Actions, Case History, and Escalation RFAs.

    Smart Noise Reduction: Automatically identifies and strips out redundant quoted email chains, signature blocks, and HTML clutter.

    LLM-Ready Prompt Generation: Generates a ready-to-paste AI system prompt that instructs an LLM to build executive summaries, chronological timelines, and extract exact environment variables/error codes.

    Meta-Prompting for Researchers: Automatically prompts your LLM to write highly targeted, boolean-optimized search queries designed specifically for internal search tools like Atlassian Rovo and Copilot.

    Structured Data Export: Download or copy the raw, parsed case data as a clean JSON payload for programmatic use.

🚀 Installation (Chrome Developer Mode)

Since this is a custom internal tool running on Manifest V3, you can load it directly into Chrome:

    Open Chrome and navigate to chrome://extensions/.

    Toggle Developer mode ON (top right corner).

    Click Load unpacked (top left).

    Select the src/content/ directory containing the manifest.json file.

    (Optional) Click the puzzle piece icon in Chrome and pin Case Ingestor to your toolbar for easy access.

🛠️ How to Use

    Navigate to any active Salesforce Case view URL (e.g., /lightning/r/Case/12345678/view).

    Click the Case Ingestor extension icon in your toolbar.

    Click Scrape Current Case. The tool will poll the page, pierce the active tab's Shadow DOM, and extract the data.

    Once the success message appears, choose your output:

        Copy AI Text: Copies a highly optimized System Prompt to your clipboard. Paste this directly into ChatGPT/Claude, and attach the JSON file.

        Download JSON: Downloads the raw structured data for the case.

        Copy JSON: Copies the raw JSON directly to your clipboard.

🧠 The AI Workflow

When you use the Copy AI Text feature, the extension generates a strict persona-driven prompt. When fed into an LLM alongside the downloaded JSON, the AI will output:

    Case Summary: An executive overview of the customer's issue and current state.

    Environment & Key Facts: Extracted software/hardware versions and verbatim error logs.

    Chronological Timeline: A deduplicated history of troubleshooting steps and escalations.

    Rovo / Copilot Prompts: Ready-to-use search queries separating Error-focused searches from Symptom-focused searches, formatted in code blocks for 1-click copying.

🏗️ Under the Hood (Architecture)

This extension strictly uses Chrome Manifest V3.

    manifest.json: Defines the V3 Service Worker and required permissions (activeTab, scripting, clipboardWrite).

    background.js: The Service Worker. Handles the dynamic, single-context injection of all necessary JavaScript files into the isolated world of the Salesforce tab.

    content.js: The main controller injected into the page. Manages state, listens for popup commands, and triggers the extraction sequence.

    gpcrmExtract.js: The extraction engine. Uses custom utilities to pierce the Lightning Locker Shadow DOMs, ensuring it only scrapes data from the currently active Salesforce console tab (ignoring hidden background cases).

    gpcrmParser.js: Normalizes the raw text, classifies events (Emails, Actions, History), and constructs the final AI prompt payload.

    caseCleanerUtils.js: Core DOM utilities, most notably the getSearchRoots function required to traverse shadowRoot boundaries.
