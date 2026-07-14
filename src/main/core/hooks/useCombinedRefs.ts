import { useRef, useCallback, type RefCallback, type Ref } from 'react';

// Определяем тип для ref, который может быть либо функцией, либо объектом
type PossibleRef<T> = Ref<T> | undefined;

export default function useCombinedRefs<T>(...refs: PossibleRef<T>[]): [RefCallback<T>, React.RefObject<T | null>] {
    const targetRef = useRef<T | null>(null);

    const setRefs = useCallback((node: T | null) => {
        // Обновляем внутренний ref
        targetRef.current = node;

        // Обновляем все переданные refs
        refs.forEach((ref) => {
            if (!ref) return;

            if (typeof ref === 'function') {
                // Если ref - это функция, вызываем её
                ref(node);
            } else {
                // Если ref - это объект, обновляем его свойство .current
                // Используем проверку, чтобы убедиться, что это действительно MutableRefObject
                // (хотя в реальном коде это почти всегда так)
                ref.current = node;
            }
        });
        },
        // Убедитесь, что массив зависимостей всегда актуален
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [...refs]
    );

    return [setRefs, targetRef];
}