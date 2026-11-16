import { createContext, useContext } from 'react';

export type ToastAction = { label: string; onAction: () => void };
export type ToastApi = { show: (message: string, action?: ToastAction) => void };

export const ToastContext = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(ToastContext);
