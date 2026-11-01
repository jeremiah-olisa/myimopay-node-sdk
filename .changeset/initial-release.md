---

'myimopay': minor
'myimopay-browser': minor
---

<!-- @sdk-owner: A10-release -->

Initial public release.

`myimopay` is a typed, dependency-free Node.js client for the MyIMO Pay gateway:
payments (initiate, split, verify), transactions, settlements, banks, subaccounts
and settlement orders, HMAC webhook verification, an event-based payment
lifecycle (no polling), `with()` overrides for any option, and the provider
quirks handled (20-character `tx_ref` cap, duplicate references, `is_settled`
winning over `status`, splits below 100%, customer-name and email rules).

`myimopay-browser` is the keyless frontend companion: open the hosted checkout,
parse the return URL as a hint, and format amounts. It ships no key handling and
no Node built-in by design.
