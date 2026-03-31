# BRMS Privacy Policy

Effective date: March 30, 2026

This Privacy Policy describes how BRMS ("Browser Runtime MCP Server", "the Extension", "we", "our") handles information.

## Summary

BRMS is a local developer tool. It reads browser runtime state (such as DOM, network metadata, console logs, and tab details) so compatible local AI tools can help debug web apps.

BRMS does not operate a cloud backend. Data is processed locally on your machine via:

- Chrome Extension
- Native Messaging Host (`brms-host`)
- Local MCP endpoint (`http://localhost:3100`)

## Information We Access

Depending on which BRMS tools you invoke, BRMS may access:

- Tab information (title, URL, tab index)
- DOM content and element attributes
- Computed styles and layout data
- Console messages and exceptions
- Network request/response metadata and selected bodies
- Screenshots of the visible tab or selected elements
- Event listener metadata

## Why We Access This Information

BRMS accesses this information only to provide browser debugging and inspection features requested by the user.

## How Information Is Processed

- Data is read from your browser through Chrome Extension APIs.
- Data is sent to the local Native Messaging Host on your machine.
- Data is exposed to local MCP clients (for example, Cursor) via `http://localhost:3100/mcp`.
- No BRMS-operated remote server is required for normal operation.

## Data Sharing

BRMS itself does not sell or broker personal data.

Data may be shared with software you choose to connect (for example, an AI assistant client) based on your own prompts and configuration. Review your AI tool provider's privacy terms separately.

## Data Retention

BRMS keeps short in-memory buffers for recent console and network entries to enable debugging features.

- These buffers are not intended as permanent storage.
- Data is cleared when the host process stops, unless your environment separately logs it.

## Security

BRMS is designed for local use. You are responsible for securing your development machine and controlling which websites and tools you use BRMS with.

## Permissions

BRMS requests permissions needed for debugging features, including:

- `debugger`
- `tabs`
- `activeTab`
- `scripting`
- `nativeMessaging`
- host access (`<all_urls>`)

These permissions are used only to provide extension functionality.

## Your Choices

You can stop BRMS at any time by:

- Disabling/removing the Chrome extension
- Closing Chrome
- Stopping the `brms-host` process
- Removing BRMS from your MCP configuration

## Children's Privacy

BRMS is not directed to children.

## Changes to This Policy

We may update this policy from time to time. Updates will be posted at the policy URL with a revised effective date.

## Contact

For questions about this Privacy Policy, open an issue at:

https://github.com/Alaap008/golliath/issues
