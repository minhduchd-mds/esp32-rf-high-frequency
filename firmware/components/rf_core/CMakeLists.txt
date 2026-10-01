idf_component_register(SRCS "../../../core/src/scanner.cpp"
                       INCLUDE_DIRS "../../../core/include")
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
