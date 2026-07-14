import { Link } from "react-router-dom";
import legalStyles from "@/core/legal/legal.module.scss";

export function LegalInlineLinks() {
    return (
        <p className={legalStyles.legalInlineLinks}>
            Регистрируясь, вы соглашаетесь с{" "}
            <Link to="/terms">пользовательским соглашением</Link>
            <span className={legalStyles.legalInlineLinksSep}>·</span>
            <Link to="/privacy">политикой конфиденциальности</Link>
        </p>
    );
}
