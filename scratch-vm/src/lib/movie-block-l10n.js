const resolveLocale = (locale, vm) => {
    if (locale) return locale;
    if (vm && typeof vm.getLocale === 'function') return vm.getLocale();
    return 'en';
};

const localize = (locale, english, japanese) => (locale === 'ja' ? japanese : english);

export {
    localize,
    resolveLocale
};
