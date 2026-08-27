/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // /admin reads the committed specs from disk at request time. The path is
    // computed, so Next's tracer cannot see it — without this the directory is
    // absent from the serverless bundle and the spec picker is empty in
    // production while working locally.
    outputFileTracingIncludes: {
      '/admin': ['./verify-service/specs/**'],
    },
  },
}

module.exports = nextConfig
