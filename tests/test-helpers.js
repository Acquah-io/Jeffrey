function stashEnv(key) {
  const value = process.env[key];
  return () => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };
}

function clearModule(modulePath) {
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
}

module.exports = {
  stashEnv,
  clearModule,
};
