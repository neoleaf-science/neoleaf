# NeoLeaf server image, built from an UNPACKED RELEASE FOLDER (neoleaf-server-<version>-linux-x86_64.tar.gz), which is the build context:
#   tar -xzf neoleaf-server-<version>-linux-x86_64.tar.gz && cd neoleaf-server-<version>-linux-x86_64
#   docker build -f install/Dockerfile -t neoleaf:local .
# The release binary is built on Ubuntu 22.04 (glibc 2.35), so it runs on Debian bookworm (glibc 2.36).
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /app neoleaf \
 && mkdir -p /app /data \
 && chown neoleaf /data

WORKDIR /app
COPY neoleaf ./neoleaf
COPY site ./site
COPY static ./static
# the license texts and notices that come with the release (the pattern keeps working if one of them is missing)
COPY LICENSES.md LICENSE-* NOTICE* ART.md* ./

# the server reads site/ and static/ relative to its working directory; everything it writes goes to /data (a volume)
ENV HOST=0.0.0.0 PORT=3000
USER neoleaf
EXPOSE 3000
CMD ["./neoleaf"]
