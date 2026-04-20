declare module 'lodash-es/memoize' {
  export default function memoize<T extends (...args: unknown[]) => unknown>(
    func: T,
    resolver?: (...args: Parameters<T>) => unknown
  ): T;
}
