import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from "react";
import { motion } from "motion/react";
import styles from "./auth.module.scss";

export interface AuthTextFieldHandle {
    value: string;
    focus: () => void;
    blur: () => void;
}

export interface AuthTextFieldProps {
    label: string;
    name?: string;
    type?: string;
    icon?: string;
    autocomplete?: string;
    required?: boolean;
    maxlength?: number;
    counter?: boolean;
    "toggle-password"?: boolean;
    defaultValue?: string;
    value?: string;
    onChange?: (value: string) => void;
    className?: string;
}

export const AuthTextField = forwardRef<AuthTextFieldHandle, AuthTextFieldProps>(
    ({ 
        label, 
        name, 
        type = "text", 
        icon,
        autocomplete,
        required = false,
        maxlength,
        counter = false,
        "toggle-password": togglePassword = false,
        defaultValue = "",
        value: controlledValue,
        onChange,
        className = ""
    }, ref) => {
        const [internalValue, setInternalValue] = useState(defaultValue);
        const [isFocused, setIsFocused] = useState(false);
        const [showPassword, setShowPassword] = useState(false);
        const [charCount, setCharCount] = useState(0);
        const inputRef = useRef<HTMLInputElement>(null);

        const isControlled = controlledValue !== undefined;
        const value = isControlled ? controlledValue : internalValue;
        const displayType = togglePassword && type === "password" ? (showPassword ? "text" : "password") : type;

        useEffect(() => {
            if (!isControlled) {
                setInternalValue(defaultValue);
            }
        }, [defaultValue, isControlled]);

        useEffect(() => {
            setCharCount(value.length);
        }, [value]);

        useImperativeHandle(ref, () => ({
            get value() {
                return value;
            },
            focus: () => {
                inputRef.current?.focus();
            },
            blur: () => {
                inputRef.current?.blur();
            }
        }));

        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = e.target.value;
            if (!isControlled) {
                setInternalValue(newValue);
            }
            onChange?.(newValue);
        };

        const hasError = false; // Can be extended for validation

        return (
            <motion.div 
                className={`${styles.authTextField} ${className}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                whileFocus={{ scale: 1.01 }}
            >
                <div className={`${styles.fieldContainer} ${isFocused ? styles.focused : ""} ${hasError ? styles.error : ""} ${!icon ? styles.noIcon : ""} ${togglePassword && type === "password" ? styles.hasToggle : ""}`}>
                    {icon && (
                        <span className={`material-symbols filled ${styles.fieldIcon}`}>
                            {icon.replace("--filled", "").replace("--outlined", "")}
                        </span>
                    )}
                    <div className={styles.inputWrapper}>
                        <input
                            ref={inputRef}
                            type={displayType}
                            name={name}
                            value={value}
                            onChange={handleChange}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                            autoComplete={autocomplete}
                            required={required}
                            maxLength={maxlength}
                            placeholder={label + (required ? " *" : "")}
                            className={styles.input}
                        />
                    </div>
                    {togglePassword && type === "password" && (
                        <button
                            type="button"
                            className={styles.togglePassword}
                            onClick={() => setShowPassword(!showPassword)}
                            tabIndex={-1}
                        >
                            <span className="material-symbols filled">
                                {showPassword ? "visibility_off" : "visibility"}
                            </span>
                        </button>
                    )}
                </div>
                {counter && maxlength && (
                    <div className={styles.counter}>
                        {charCount} / {maxlength}
                    </div>
                )}
            </motion.div>
        );
    }
);

AuthTextField.displayName = "AuthTextField";
