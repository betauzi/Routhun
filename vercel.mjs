// Vercel hosts the Vite frontend; the stateful API must live on a persistent host.
// Vercel reads this dynamic configuration before the build.
const origin = process.env.BACKEND_ORIGIN;
if (process.env.VERCEL && !origin) throw new Error('Set BACKEND_ORIGIN to the HTTPS URL of the persistent API before deploying.');
if (origin) {
  const backend = new URL(origin);
  if (backend.protocol !== 'https:' || backend.pathname !== '/' || backend.search || backend.hash || backend.username || backend.password)
    throw new Error('BACKEND_ORIGIN must be a bare HTTPS origin, e.g. https://api.example.org');
}
export const config = {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    ...(origin ? [{ source: '/api/:path*', destination: `${origin}/api/:path*` }] : []),
    { source: '/(.*)', destination: '/index.html' }
  ]
};
