// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import { MyImoPayError } from '@myimopay/core';

/**
 * The `browser` export condition of `myimopay`.
 *
 * Server SDKs carry the merchant secret key. Bundlers that ignore the `browser`
 * condition would still pull it into a client bundle, so the module fails loudly
 * at import time instead of shipping a key to a browser.
 *
 * Nothing but the error class is imported here: this file is the browser
 * condition of the package, so it must never reach a Node built-in.
 */
throw new MyImoPayError({
  code: 'SERVER_ONLY',
  message:
    'myimopay is server-only. Install myimopay-browser for frontend checkout helpers: it is keyless by design and cannot leak your merchant key.',
});
