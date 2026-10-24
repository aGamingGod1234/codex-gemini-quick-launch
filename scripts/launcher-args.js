function parseArgs(argv, { allowProvider = true } = {}) {
  const result = { provider: null, model: null, noLaunch: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const option = token.toLowerCase();
    if ((allowProvider && option === '--provider') || ['--model', '-m', '-model'].includes(option)) {
      const value = argv[++i];
      if (!value || !value.trim() || value.startsWith('-')) {
        throw new Error(`Missing value for ${token}.`);
      }
      result[option === '--provider' ? 'provider' : 'model'] = value.trim();
    } else if (option === '--no-launch' || option === '-nolaunch') {
      result.noLaunch = true;
    } else {
      throw new Error(`Unknown launcher option: ${token}`);
    }
  }
  return result;
}

module.exports = { parseArgs };
