import { Fragment, useId } from "react";
import { useTranslations } from "@kaipu/i18n";
import { ModalActions, ModalButton } from "@kaipu/ui";
import {
  destinationAllowed,
  type LibraryDestination,
  type LibraryItemKind,
} from "../add-from-library";
import styles from "./add-destination-chooser.module.css";

export interface AddDestinationChooserProps {
  /** What is selected: a recording cannot go over the video yet, so that option is disabled. */
  kind: LibraryItemKind;
  value: LibraryDestination;
  /** The playhead label ("2:49.4"), said under "Over the video" because that is where it floats. */
  playheadLabel: string;
  onChange(destination: LibraryDestination): void;
  /** The single Add: applies the selection at `value`. */
  onAdd(): void;
}

/**
 * The one place an Add from Library item is sent (NIW2-829): a radio list of every destination
 * and one Add button. "Over the video" keeps the recording playing; the four sequence places
 * push what comes after. A radio group, so the arrow keys move the choice and Tab leaves it.
 */
export function AddDestinationChooser({
  kind,
  value,
  playheadLabel,
  onChange,
  onAdd,
}: AddDestinationChooserProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const name = useId();
  const overAllowed = destinationAllowed(kind, "over");
  // The order the chooser lists the sequence places under "In the sequence".
  const sequenceOptions: ReadonlyArray<{ id: LibraryDestination; label: string }> = [
    { id: "before-clip", label: t("addFromLibraryDestBefore") },
    { id: "after-clip", label: t("addFromLibraryDestAfter") },
    { id: "start", label: t("addFromLibraryDestStart") },
    { id: "end", label: t("addFromLibraryDestEnd") },
  ];

  const option = (
    id: LibraryDestination,
    label: string,
    hint?: string,
    disabled = false,
  ): React.JSX.Element => (
    <label className={styles.option} data-disabled={disabled ? "true" : undefined}>
      <input
        type="radio"
        className={styles.radio}
        name={name}
        value={id}
        checked={value === id}
        disabled={disabled}
        onChange={() => onChange(id)}
      />
      <span className={styles.optionText}>
        <span className={styles.optionLabel}>{label}</span>
        {hint && <span className={styles.optionHint}>{hint}</span>}
      </span>
    </label>
  );

  return (
    <div className={styles.chooser} data-testid="add-destination-chooser">
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{t("addFromLibraryDestinationLegend")}</legend>
        {option(
          "over",
          t("addFromLibraryDestOver"),
          overAllowed
            ? t("addFromLibraryDestOverHint", { time: playheadLabel })
            : t("addFromLibraryDestOverLater"),
          !overAllowed,
        )}
        <div role="group" aria-labelledby={`${name}-sequence`} className={styles.group}>
          <p className={styles.groupTitle} id={`${name}-sequence`}>
            {t("addFromLibraryDestSequence")}
          </p>
          <p className={styles.groupHint}>{t("addFromLibraryDestSequenceHint")}</p>
          {sequenceOptions.map(({ id, label }) => (
            <Fragment key={id}>{option(id, label)}</Fragment>
          ))}
        </div>
      </fieldset>
      <div className={styles.cta}>
        <ModalActions>
          <ModalButton variant="primary" onClick={onAdd}>
            {t("addFromLibraryAdd")}
          </ModalButton>
        </ModalActions>
      </div>
    </div>
  );
}
