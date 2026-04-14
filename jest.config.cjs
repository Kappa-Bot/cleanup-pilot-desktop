module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/test"],
  testPathIgnorePatterns: ["<rootDir>/test/e2e/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  transform: {
    "^.+\\.(t|j)sx?$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2020",
          parser: {
            syntax: "typescript",
            tsx: true,
            dynamicImport: true
          },
          transform: {
            react: {
              runtime: "automatic"
            }
          }
        },
        module: {
          type: "commonjs"
        }
      }
    ]
  }
};
