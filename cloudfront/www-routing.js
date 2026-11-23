// CloudFront Function "wwwRouting" (viewer request, runtime cloudfront-js-2.0).
// Paste into the CloudFront console and publish; it is not deployed by CI.
function handler(event) {
  var req = event.request;

  // One canonical domain: www -> apex
  if (req.headers.host.value === 'www.mp3playground.com') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: 'https://mp3playground.com' + req.uri } }
    };
  }

  // Clean URLs for tool pages: /audio-cutter and /audio-cutter/ -> /audio-cutter/index.html.
  // Paths with a file extension (/privacy.html, /assets/x.js) and "/" are left alone.
  var uri = req.uri;
  if (uri !== '/') {
    var last = uri.substring(uri.lastIndexOf('/') + 1);
    if (last === '') {
      req.uri = uri + 'index.html';
    } else if (last.indexOf('.') === -1) {
      req.uri = uri + '/index.html';
    }
  }
  return req;
}
