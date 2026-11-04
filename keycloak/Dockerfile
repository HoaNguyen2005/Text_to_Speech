FROM quay.io/keycloak/keycloak:26.8.0

ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true

COPY --chown=keycloak:keycloak themes/text2speech/ /opt/keycloak/themes/text2speech/
RUN /opt/keycloak/bin/kc.sh build

ENV KC_HTTP_ENABLED=true \
    KC_HTTP_PORT=10000 \
    KC_PROXY_HEADERS=xforwarded

EXPOSE 10000
CMD ["start", "--optimized"]
