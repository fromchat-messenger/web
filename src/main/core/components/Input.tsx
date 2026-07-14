import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import useCombinedRefs from '@/core/hooks/useCombinedRefs';
import { id } from '@/utils/utils';

interface AutoResizeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    autoresizing?: true;
    placeholderMinWidth?: boolean;
    onAutosize?: (width: number) => void;
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    autoresizing?: false;
    placeholderMinWidth?: false;
    onAutosize?: undefined;
}

export function Input({ 
    autoresizing = false,
    placeholderMinWidth = false,
    onAutosize,
    style: inputStyle,
    ...inputProps
}: AutoResizeInputProps | InputProps) {
    const [inputWidth, setInputWidth] = useState(0);

    const sizerRef = useRef<HTMLDivElement>(null);
    const placeholderSizerRef = useRef<HTMLDivElement>(null);
    const [inputRef, inputElement] = useCombinedRefs<HTMLInputElement>();

    const sizerStyle: React.CSSProperties = {
        position: 'absolute',
        top: 0,
        left: 0,
        visibility: 'hidden',
        height: 0,
        overflow: 'scroll',
        whiteSpace: 'pre',
    };

    const copyStyles = useCallback((styles: CSSStyleDeclaration, node: HTMLElement) => {
        node.style.fontSize = styles.fontSize;
        node.style.fontFamily = styles.fontFamily;
        node.style.fontWeight = styles.fontWeight;
        node.style.fontStyle = styles.fontStyle;
        node.style.letterSpacing = styles.letterSpacing;
        node.style.textTransform = styles.textTransform;
    }, []);

    const updateInputWidth = useCallback(() => {
        if (!sizerRef.current || typeof sizerRef.current.scrollWidth === 'undefined') {
            return;
        }

        let newInputWidth: number;
        
        if (inputProps.placeholder && (!inputProps.value || (inputProps.value && placeholderMinWidth))) {
            const sizerWidth = sizerRef.current.scrollWidth;
            const placeholderWidth = placeholderSizerRef.current?.scrollWidth || 0;
            newInputWidth = Math.max(sizerWidth, placeholderWidth) + 2;
        } else {
            newInputWidth = sizerRef.current.scrollWidth + 2;
        }


        if (newInputWidth !== inputWidth) {
            setInputWidth(newInputWidth);
            onAutosize?.(newInputWidth);
        }
    }, [inputProps.placeholder, inputProps.value, inputProps.type, placeholderMinWidth, inputWidth, onAutosize]);

    const copyInputStyles = useCallback(() => {
        if (!inputElement.current || !window.getComputedStyle) {
            return;
        }

        const inputStyles = window.getComputedStyle(inputElement.current);
        if (!inputStyles) {
            return;
        }

        copyStyles(inputStyles, sizerRef.current!);
        if (placeholderSizerRef.current) {
            copyStyles(inputStyles, placeholderSizerRef.current);
        }
    }, [inputElement]);

    useEffect(() => {
        if (autoresizing) {
            copyInputStyles();
            updateInputWidth();
        }
    }, [autoresizing, copyInputStyles, updateInputWidth]);

    useEffect(() => {
        if (autoresizing) {
            updateInputWidth();
        }
    }, [inputProps.value, inputProps.placeholder, autoresizing, updateInputWidth]);

    return (
        <>
            <input
                {...inputProps}
                ref={inputRef}
                style={{
                    boxSizing: 'content-box',
                    width: autoresizing ? `${inputWidth}px` : undefined,
                    ...inputStyle,
                }}
            />
            {autoresizing && createPortal(
                <>
                    <div ref={sizerRef} style={sizerStyle}>
                        {inputProps.defaultValue || inputProps.value || ''}
                    </div>
                    {inputProps.placeholder && (
                        <div ref={placeholderSizerRef} style={sizerStyle}>
                            {inputProps.placeholder}
                        </div>
                    )}
                </>,
                id("root")
            )}
        </>
    );
}
