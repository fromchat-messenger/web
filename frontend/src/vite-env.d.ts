/// <reference types="vite/client" />
/// <reference types="mdui/jsx.en.d.ts" />
/// <reference types="./core/types.d.ts" />

declare global {
    namespace React {
        // Augment React synthetic events to provide typed target for ALL HTML elements
        interface SyntheticEvent<T = Element, E = Event> {
            target: EventTarget & T;
        }

        namespace JSX {
            interface IntrinsicElements {
                "mdui-ripple": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
            }
        }
    }

    // Augment DOM event listeners to provide typed target for ALL elements
    // This works by augmenting the base Element interface which covers all HTML, SVG, etc.
    interface Element {
        addEventListener<K extends keyof HTMLElementEventMap>(
            type: K,
            listener: (this: Element, ev: HTMLElementEventMap[K] & { target: Element }) => any,
            options?: boolean | AddEventListenerOptions
        ): void;
        removeEventListener<K extends keyof HTMLElementEventMap>(
            type: K,
            listener: (this: Element, ev: HTMLElementEventMap[K] & { target: Element }) => any,
            options?: boolean | EventListenerOptions
        ): void;
    }
}

export {};