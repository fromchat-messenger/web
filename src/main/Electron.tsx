import { PRODUCT_NAME } from "./core/config";
import { isElectron } from "./core/electron/electron";

export function ElectronTitleBar() {
    return isElectron && (
        <div id="electron-title-bar">
            {window.electronInterface.platform == "darwin" && <div className="macos-padding"></div>}
            <div id="window-title">{PRODUCT_NAME}</div>
        </div>
    )
}