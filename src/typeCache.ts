import { GoplsTypeInfo } from './goplsProvider';

/**
 * Cache key for type information
 */
interface CacheKey {
    uri: string;
    line: number;
    character: number;
}

/**
 * Cache entry with timestamp for expiration
 */
interface CacheEntry {
    info: GoplsTypeInfo;
    timestamp: number;
}

/**
 * Cache for gopls type information
 * Avoids repeated queries to gopls for the same positions
 */
export class TypeCache {
    private cache: Map<string, CacheEntry> = new Map();
    private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

    /**
     * Generate a cache key string from URI and position
     */
    private makeKey(uri: string, line: number, character: number): string {
        return `${uri}:${line}:${character}`;
    }

    /**
     * Get cached type info for a position
     */
    get(uri: string, line: number, character: number): GoplsTypeInfo | undefined {
        const key = this.makeKey(uri, line, character);
        const entry = this.cache.get(key);

        if (!entry) {
            return undefined;
        }

        // Check if entry has expired
        if (Date.now() - entry.timestamp > this.TTL_MS) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.info;
    }

    /**
     * Cache type info for a position
     */
    set(uri: string, line: number, character: number, info: GoplsTypeInfo): void {
        const key = this.makeKey(uri, line, character);
        this.cache.set(key, {
            info,
            timestamp: Date.now()
        });
    }

    /**
     * Invalidate all cached entries for a document
     */
    invalidate(uri: string): void {
        const prefix = uri + ':';
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Clear all cached entries
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats(): { size: number; oldestEntry: number | null } {
        let oldestTimestamp: number | null = null;

        for (const entry of this.cache.values()) {
            if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
                oldestTimestamp = entry.timestamp;
            }
        }

        return {
            size: this.cache.size,
            oldestEntry: oldestTimestamp ? Date.now() - oldestTimestamp : null
        };
    }

    /**
     * Clean up expired entries
     */
    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.TTL_MS) {
                this.cache.delete(key);
            }
        }
    }
}

/** Singleton instance of the type cache */
export const typeCache = new TypeCache();
