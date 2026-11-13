FROM quay.io/keycloak/keycloak:26.8.0

ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true

# Render can build from the repository root. Local builds also accept ./keycloak.
RUN --mount=type=bind,target=/build \
    set -eu; \
    theme=/build/themes/text2speech; \
    if [ -d /build/keycloak/themes/text2speech ]; then \
      theme=/build/keycloak/themes/text2speech; \
    fi; \
    cp -R "$theme" /opt/keycloak/themes/; \
    /opt/keycloak/bin/kc.sh build

ENV KC_HTTP_ENABLED=true \
    KC_HTTP_PORT=10000 \
    KC_PROXY_HEADERS=xforwarded

EXPOSE 10000
CMD ["start", "--optimized"]
