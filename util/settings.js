export function getBoundedIntSetting(settings, key, defaultValue, min, max) {
    let value;
    try {
        value = settings?.get_int?.(key);
    } catch (_e) {
        return defaultValue;
    }

    if (!Number.isFinite(value))
        return defaultValue;

    return Math.max(min, Math.min(max, value));
}
