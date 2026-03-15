/**
 * @fileoverview MDUI component imports and configuration
 * @description Imports all required MDUI components and sets up the theme
 * @author Cursor
 * @version 1.0.0
 */

import 'mdui/components/tabs';
import 'mdui/components/tab';
import 'mdui/components/tab-panel';
import 'mdui/components/list';
import 'mdui/components/list-item';
import 'mdui/components/bottom-app-bar';
import 'mdui/components/button-icon';
import 'mdui/components/fab';
import 'mdui/components/button';
import 'mdui/components/text-field';
import 'mdui/components/button-icon';
import 'mdui/components/switch';
import 'mdui/components/ripple';
import 'mdui/components/chip';
import 'mdui/components/badge';
import "mdui/mdui.css";
import 'mdui/components/circular-progress';

import { setColorScheme } from 'mdui/functions/setColorScheme';
import type { ChangeEventHandler, ComponentProps, ComponentPropsWithoutRef, FormEventHandler, Ref } from 'react';
import type { TextField } from 'mdui/components/text-field';
import type { Switch } from 'mdui/components/switch';
import type { Override } from '@/core/types';
import type { Button } from 'mdui/components/button';
import type { ButtonIcon } from 'mdui/components/button-icon';
import type { Ripple } from 'mdui/components/ripple';
import type { Icon } from 'mdui/components/icon';
import type { Fab } from 'mdui/components/fab';
import type { Tabs } from 'mdui/components/tabs';
import type { Tab } from 'mdui/components/tab';
import type { TabPanel } from 'mdui/components/tab-panel';
import type { List } from 'mdui/components/list';
import type { ListItem } from 'mdui/components/list-item';
import type { Badge } from 'mdui/components/badge';
import type { CircularProgress } from 'mdui/components/circular-progress';
import type { BottomAppBar } from 'mdui/components/bottom-app-bar';

setColorScheme("#9333EA");

type BasePropCustomization<Tag extends keyof React.JSX.IntrinsicElements, Type> = Override<ComponentPropsWithoutRef<Tag>, {
    ref?: Ref<Type>;
    onInput?: (event: Override<FormEventHandler<Type>, { target: Type }>) => void;
    onChange?: (event: Override<ChangeEventHandler<Type>, { target: Type }>) => void;
}>;

type NoChildren<T> = Omit<T, "children">;

// -----------------------------
// Normalized HTML element types
// -----------------------------
export type MDUITextField = Override<HTMLElement, TextField>;
export type MDUISwitch = Override<HTMLElement, Switch>;
export type MDUIButton = Override<HTMLElement, Button>;
export type MDUIButtonIcon = Override<HTMLElement, ButtonIcon>;
export type MDUIIcon = Override<HTMLElement, Icon>;
export type MDUIRipple = Override<HTMLElement, Ripple>;
export type MDUIFab = Override<HTMLElement, Fab>;
export type MDUITabs = Override<HTMLElement, Tabs>;
export type MDUITab = Override<HTMLElement, Tab>;
export type MDUITabPanel = Override<HTMLElement, TabPanel>; 
export type MDUIList = Override<HTMLElement, List>;
export type MDUIListItem = Override<HTMLElement, ListItem>;
export type MDUIBadge = Override<HTMLElement, Badge>;
export type MDUICircularProgress = Override<HTMLElement, CircularProgress>;
export type MDUIBottomAppBar = Override<HTMLElement, BottomAppBar>;

// -------------------------------------------
// MDUI components wrapped in React components
// -------------------------------------------

export type MaterialTextFieldProps = BasePropCustomization<"mdui-text-field", MDUITextField>;
export function MaterialTextField(props: MaterialTextFieldProps) {
    return <mdui-text-field autocomplete="off" {...props as ComponentProps<"mdui-text-field">} />
}

export type MaterialSwitchProps = BasePropCustomization<"mdui-switch", MDUISwitch>;
export function MaterialSwitch(props: MaterialSwitchProps) {
    return <mdui-switch {...props as ComponentProps<"mdui-switch">} />
}

export type MaterialButtonProps = BasePropCustomization<"mdui-button", MDUIButton>;
export function MaterialButton(props: MaterialButtonProps) {
    return <mdui-button {...props as ComponentProps<"mdui-button">} />
}

export type MaterialIconButtonProps = NoChildren<BasePropCustomization<"mdui-button-icon", MDUIButtonIcon>>;
export function MaterialIconButton(props: MaterialIconButtonProps) {
    return <mdui-button-icon {...props as ComponentProps<"mdui-button-icon">} />
}

export type MaterialIconProps = NoChildren<BasePropCustomization<"mdui-icon", MDUIIcon>>;
export function MaterialIcon(props: MaterialIconProps) {
    return <mdui-icon {...props as ComponentProps<"mdui-icon">} />
}

export type MaterialFabProps = NoChildren<BasePropCustomization<"mdui-fab", MDUIFab>>;
export function MaterialFab(props: MaterialFabProps) {
    return <mdui-fab {...props as ComponentProps<"mdui-fab">} />
}

export type MaterialTabsProps = BasePropCustomization<"mdui-tabs", MDUITabs>;
export function MaterialTabs(props: MaterialTabsProps) {
    return <mdui-tabs {...props as ComponentProps<"mdui-tabs">} />
}

export type MaterialTabProps = BasePropCustomization<"mdui-tab", MDUITab>;
export function MaterialTab(props: MaterialTabProps) {
    return <mdui-tab {...props as ComponentProps<"mdui-tab">} />
}

export type MaterialTabPanelProps = BasePropCustomization<"mdui-tab-panel", MDUITabPanel>;
export function MaterialTabPanel(props: MaterialTabPanelProps) {
    return <mdui-tab-panel {...props as ComponentProps<"mdui-tab-panel">} />
}

export type MaterialListProps = BasePropCustomization<"mdui-list", MDUIList>;
export function MaterialList(props: MaterialListProps) {
    return <mdui-list {...props as ComponentProps<"mdui-list">} />
}

export type MaterialListItemProps = BasePropCustomization<"mdui-list-item", MDUIListItem>;
export function MaterialListItem(props: MaterialListItemProps) {
    return <mdui-list-item {...props as ComponentProps<"mdui-list-item">} />
}

export type MaterialBadgeProps = BasePropCustomization<"mdui-badge", MDUIBadge>;
export function MaterialBadge(props: MaterialBadgeProps) {
    return <mdui-badge {...props as ComponentProps<"mdui-badge">} />
}

export type MaterialCircularProgressProps = NoChildren<BasePropCustomization<"mdui-circular-progress", MDUICircularProgress>>;
export function MaterialCircularProgress(props: MaterialCircularProgressProps) {
    return <mdui-circular-progress {...props as ComponentProps<"mdui-circular-progress">} />
}

export type MaterialBottomAppBarProps = BasePropCustomization<"mdui-bottom-app-bar", MDUIBottomAppBar>;
export function MaterialBottomAppBar(props: MaterialBottomAppBarProps) {
    return <mdui-bottom-app-bar {...props as ComponentProps<"mdui-bottom-app-bar">} />
}

export type MaterialRippleProps = BasePropCustomization<"div", MDUIRipple>;
export function MaterialRipple(props: MaterialRippleProps) {
    // Wrapper component for future custom ripple usage; MDUI buttons already include real ripple.
    return <div {...props as ComponentProps<"div">} />;
}