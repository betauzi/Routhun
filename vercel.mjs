// Vercel hosts the Vite frontend; the stateful API must live on a persistent host.
// Vercel reads this dynamic configuration before the build.
const origin = process.env.BACKEND_ORIGIN;
// A missing API selects a clearly labelled, read-only showcase instead of a broken proxy.
if (origin) {
  const backend = new URL(origin);
  if (backend.protocol !== 'https:' || backend.pathname !== '/' || backend.search || backend.hash || backend.username || backend.password)
    throw new Error('BACKEND_ORIGIN must be a bare HTTPS origin, e.g. https://api.example.org');
}
export const config = {
  framework: 'vite',
  buildCommand: origin ? 'npm run build' : 'npm run build:demo',
  outputDirectory: 'dist',
  rewrites: [
    ...(origin ? [{ source: '/api/:path*', destination: `${origin}/api/:path*` }] : []),
    { source: '/(.*)', destination: '/index.html' }
  ]
};
