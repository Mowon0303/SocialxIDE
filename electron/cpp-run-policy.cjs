function cppCompileSourceFiles(sourceFiles) {
  if (!Array.isArray(sourceFiles)) {
    return [];
  }
  return sourceFiles.filter((filePath) => /\.(cpp|cc|cxx)$/i.test(filePath));
}

module.exports = { cppCompileSourceFiles };
