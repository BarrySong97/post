import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button, Modal, useOverlayState } from "@heroui/react";
import { Loader2, TriangleAlert } from "lucide-react";

export type ConfirmModalVariant = "default" | "danger";

export type ConfirmModalOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  variant?: ConfirmModalVariant;
  onConfirm?: () => Promise<void> | void;
  onCancel?: () => Promise<void> | void;
};

type ConfirmModalRequest = ConfirmModalOptions & {
  resolve: (confirmed: boolean) => void;
};

type ConfirmModalContextValue = {
  confirm: (options: ConfirmModalOptions) => Promise<boolean>;
};

const ConfirmModalContext = createContext<ConfirmModalContextValue | null>(null);

export function ConfirmModalProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmModalRequest | null>(null);
  const [busyAction, setBusyAction] = useState<"confirm" | "cancel" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const closeRequest = useCallback((confirmed: boolean) => {
    setRequest((current) => {
      current?.resolve(confirmed);
      return null;
    });
    setBusyAction(null);
    setErrorMessage(null);
  }, []);

  const handleCancel = useCallback(async () => {
    if (!request || busyAction) {
      return;
    }

    try {
      setBusyAction("cancel");
      await request.onCancel?.();
      closeRequest(false);
    } catch (error) {
      setBusyAction(null);
      setErrorMessage(error instanceof Error ? error.message : "取消操作失败");
    }
  }, [busyAction, closeRequest, request]);

  const modalState = useOverlayState({
    isOpen: Boolean(request),
    onOpenChange: (isOpen) => {
      if (!isOpen) {
        void handleCancel();
      }
    },
  });

  const confirm = useCallback((options: ConfirmModalOptions) => {
    return new Promise<boolean>((resolve) => {
      setErrorMessage(null);
      setBusyAction(null);
      setRequest({ ...options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!request || busyAction) {
      return;
    }

    try {
      setBusyAction("confirm");
      setErrorMessage(null);
      await request.onConfirm?.();
      closeRequest(true);
    } catch (error) {
      setBusyAction(null);
      setErrorMessage(error instanceof Error ? error.message : "确认操作失败");
    }
  }, [busyAction, closeRequest, request]);

  const value = useMemo<ConfirmModalContextValue>(() => ({ confirm }), [confirm]);
  const variant = request?.variant ?? "default";
  const confirmClassName = variant === "danger"
    ? "min-w-20 rounded-lg bg-red-600 px-3 text-[12px] font-semibold text-white hover:bg-red-700"
    : "min-w-20 rounded-lg px-3 text-[12px] font-semibold";

  return (
    <ConfirmModalContext.Provider value={value}>
      {children}
      <Modal.Root state={modalState}>
        <Modal.Backdrop isDismissable={!busyAction} variant="opaque" className="z-[200]">
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog className="outline-none">
              <Modal.Header className="flex items-start gap-3 px-5 pb-2 pt-5">
                {variant === "danger" ? (
                  <Modal.Icon className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-50 text-red-600">
                    <TriangleAlert size={17} />
                  </Modal.Icon>
                ) : null}
                <div className="min-w-0 flex-1">
                  <Modal.Heading className="text-[15px] font-semibold text-zinc-950">
                    {request?.title}
                  </Modal.Heading>
                </div>
              </Modal.Header>
              <Modal.Body className="px-5 pb-2 pt-0">
                {request?.description ? (
                  <div className="text-[13px] leading-5 text-zinc-600">{request.description}</div>
                ) : null}
                {errorMessage ? (
                  <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
                    {errorMessage}
                  </div>
                ) : null}
              </Modal.Body>
              <Modal.Footer className="flex items-center justify-end gap-2 px-5 pb-5 pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 min-h-0 rounded-lg px-3 text-[12px] text-zinc-600"
                  isDisabled={Boolean(busyAction)}
                  onPress={() => void handleCancel()}
                >
                  {busyAction === "cancel" ? <Loader2 size={13} className="animate-spin" /> : null}
                  {request?.cancelLabel ?? "取消"}
                </Button>
                <Button
                  size="sm"
                  variant={variant === "danger" ? "secondary" : "primary"}
                  className={`h-8 min-h-0 ${confirmClassName}`}
                  isDisabled={Boolean(busyAction)}
                  onPress={() => void handleConfirm()}
                >
                  {busyAction === "confirm" ? <Loader2 size={13} className="animate-spin" /> : null}
                  {request?.confirmLabel ?? "确认"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </ConfirmModalContext.Provider>
  );
}

export function useConfirmModal() {
  const value = useContext(ConfirmModalContext);
  if (!value) {
    throw new Error("useConfirmModal must be used inside ConfirmModalProvider");
  }

  return value.confirm;
}
