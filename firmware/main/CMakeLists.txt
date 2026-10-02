set(RF_WEB_REQUIRES
    rf_core
    esp_timer
    freertos
    esp_https_server
    esp_wifi
    esp_event
    esp_netif
    nvs_flash
)

if(CONFIG_RF_DEVICE_WEB_HTTPS
   AND EXISTS "${CMAKE_CURRENT_LIST_DIR}/certs/server.crt"
   AND EXISTS "${CMAKE_CURRENT_LIST_DIR}/certs/server.key")
    idf_component_register(
        SRCS "main.cpp" "device_web_server.cpp"
        INCLUDE_DIRS "."
        REQUIRES ${RF_WEB_REQUIRES}
        EMBED_TXTFILES "certs/server.crt" "certs/server.key"
    )
    target_compile_definitions(${COMPONENT_LIB} PRIVATE RF_WEB_CERT_EMBEDDED=1)
else()
    idf_component_register(
        SRCS "main.cpp" "device_web_server.cpp"
        INCLUDE_DIRS "."
        REQUIRES ${RF_WEB_REQUIRES}
    )
    target_compile_definitions(${COMPONENT_LIB} PRIVATE RF_WEB_CERT_EMBEDDED=0)
endif()
