import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  type LlmRoleId,
  type LlmSettingsPatch,
  type LlmSettingsPublic,
} from "../../api";
import { useI18n } from "../../i18n";

export function PiSection(props: {
  onError: (s: string) => void;
  onStatus: (s: string) => void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<LlmSettingsPublic | null>(null);
  const [busy, setBusy] = useState(false);
  const [dualLoop, setDualLoop] = useState(false);
  const [dualMock, setDualMock] = useState(true);
  const [crossJudge, setCrossJudge] = useState(false);
  const [pi, setPi] = useState({
    provider: "",
    base_url: "",
    default_model: "",
    api_key: "",
    clear_api_key: false,
  });
  const [roleModels, setRoleModels] = useState<Record<LlmRoleId, string>>({
    planner: "",
    implementer: "",
    reviewer: "",
    judge: "",
  });

  function hydrate(s: LlmSettingsPublic) {
    setSettings(s);
    setDualLoop(s.dual_loop_enabled);
    setDualMock(s.dual_loop_mock);
    setCrossJudge(s.cross_judge);
    setPi({
      provider: s.pi.provider ?? "",
      base_url: s.pi.base_url ?? "",
      default_model: s.pi.default_model ?? "",
      api_key: "",
      clear_api_key: false,
    });
    setRoleModels({
      planner: s.role_models.planner ?? "",
      implementer: s.role_models.implementer ?? "",
      reviewer: s.role_models.reviewer ?? "",
      judge: s.role_models.judge ?? "",
    });
  }

  useEffect(() => {
    (async () => {
      try {
        hydrate(await api.getLlmSettings());
      } catch (err) {
        props.onError((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    props.onError("");
    try {
      const patch: LlmSettingsPatch = {
        dual_loop_enabled: dualLoop,
        dual_loop_mock: dualMock,
        cross_judge: crossJudge,
        pi: {
          provider: pi.provider.trim() || null,
          base_url: pi.base_url.trim() || null,
          default_model: pi.default_model.trim() || null,
          clear_api_key: pi.clear_api_key || undefined,
          api_key: pi.clear_api_key ? undefined : pi.api_key || undefined,
        },
        role_models: {
          planner: roleModels.planner.trim() || null,
          implementer: roleModels.implementer.trim() || null,
          reviewer: roleModels.reviewer.trim() || null,
          judge: roleModels.judge.trim() || null,
        },
      };
      const res = await api.putLlmSettings(patch);
      hydrate(res.settings);
      props.onStatus(t("models.saved"));
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const roles: LlmRoleId[] = [
    "planner",
    "implementer",
    "reviewer",
    "judge",
  ];

  if (!settings) return <p className="empty">{t("metrics.loading")}</p>;

  return (
    <div className="panel">
      <h2>{t("models.title")}</h2>
      <p className="lede" style={{ marginBottom: "1rem" }}>
        {t("models.lede")}
      </p>
      <form className="form-grid" onSubmit={onSave}>
        <label className="check">
          <input
            type="checkbox"
            checked={dualLoop}
            onChange={(e) => setDualLoop(e.target.checked)}
          />
          {t("models.dualLoop")}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={dualMock}
            onChange={(e) => setDualMock(e.target.checked)}
          />
          {t("models.dualMock")}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={crossJudge}
            onChange={(e) => setCrossJudge(e.target.checked)}
          />
          {t("models.crossJudge")}
        </label>

        <div className="panel" style={{ marginBottom: 0 }}>
          <h3 className="subhead" style={{ marginTop: 0 }}>
            {t("models.piSection")}
            <span className="muted">
              {" "}
              ·{" "}
              {settings.pi.api_key_set
                ? t("models.keySet", {
                    hint: settings.pi.api_key_hint ?? "••••",
                  })
                : t("models.keyMissing")}
            </span>
          </h3>
          <div className="form-grid">
            <label>
              {t("models.provider")}
              <input
                value={pi.provider}
                placeholder="openai | anthropic | compatible"
                onChange={(e) => setPi({ ...pi, provider: e.target.value })}
              />
            </label>
            <label>
              {t("models.defaultModel")}
              <input
                value={pi.default_model}
                placeholder="gpt-4o-mini"
                onChange={(e) =>
                  setPi({ ...pi, default_model: e.target.value })
                }
              />
            </label>
            <label>
              {t("models.baseUrl")}
              <input
                value={pi.base_url}
                placeholder="https://…"
                onChange={(e) => setPi({ ...pi, base_url: e.target.value })}
              />
            </label>
            <label>
              {t("models.apiKey")}
              <input
                type="password"
                autoComplete="new-password"
                value={pi.api_key}
                placeholder={t("models.apiKeyPlaceholder")}
                onChange={(e) =>
                  setPi({
                    ...pi,
                    api_key: e.target.value,
                    clear_api_key: false,
                  })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={pi.clear_api_key}
                onChange={(e) =>
                  setPi({
                    ...pi,
                    clear_api_key: e.target.checked,
                    api_key: e.target.checked ? "" : pi.api_key,
                  })
                }
              />
              {t("models.clearKey")}
            </label>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 0 }}>
          <h3 className="subhead" style={{ marginTop: 0 }}>
            {t("models.rolesSection")}
          </h3>
          <div className="form-grid">
            {roles.map((role) => {
              const roleTitle =
                role === "planner"
                  ? t("models.role.planner")
                  : role === "implementer"
                    ? t("models.role.implementer")
                    : role === "reviewer"
                      ? t("models.role.reviewer")
                      : t("models.role.judge");
              return (
                <label key={role}>
                  {roleTitle}
                  <input
                    value={roleModels[role]}
                    placeholder={pi.default_model || "inherit default"}
                    onChange={(e) =>
                      setRoleModels({
                        ...roleModels,
                        [role]: e.target.value,
                      })
                    }
                  />
                </label>
              );
            })}
          </div>
        </div>

        <p className="muted mono wrap">
          {t("models.path")}: {settings.settings_path}
          <br />
          {settings.host_env_note}
        </p>
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>
            {t("models.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
