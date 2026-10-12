// Public browser configuration. Secrets must remain on the meeting server.
// Update the canonical endpoint after deployment. The second endpoint is only
// used for reconnect failover; it is not a traffic-balancing pool.
const configuredEndpoints = [
  {
    name: 'Primary',
    baseUrl: 'https://just-holly-kanhaiya1610-b072918c.koyeb.app'
  },
  {
    name: 'Failover',
    baseUrl: 'https://webrtc-meeting-server.onrender.com'
  }
];

const localEndpoints = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? [{ name: 'Local', baseUrl: `${window.location.protocol}//${window.location.hostname}:8080` }]
  : configuredEndpoints;

window.APP_CONFIG = {
  googleClientId: '173379398027-i3h11rufg14tpde9rhutp0uvt3imos3k.apps.googleusercontent.com',
  endpoints: localEndpoints
};
