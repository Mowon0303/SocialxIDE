function desktopContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function shouldOpenExternalUrl(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function isPermittedNavigationUrl(url, currentUrl) {
  if (url === currentUrl) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:'
      && parsed.hostname === 'localhost'
      && parsed.port === '4200';
  } catch {
    return false;
  }
}

module.exports = {
  desktopContentSecurityPolicy,
  isPermittedNavigationUrl,
  shouldOpenExternalUrl,
};
