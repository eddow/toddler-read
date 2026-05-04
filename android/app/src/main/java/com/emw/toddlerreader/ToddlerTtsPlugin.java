package com.emw.toddlerreader;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.UUID;

@CapacitorPlugin(name = "ToddlerTts")
public class ToddlerTtsPlugin extends Plugin implements TextToSpeech.OnInitListener {
    private TextToSpeech textToSpeech;
    private boolean isReady = false;
    private PluginCall pendingSpeakCall;
    private String pendingText = "";
    private String pendingLang = "en";
    private String pendingUtteranceId = "";

    @Override
    public void load() {
        textToSpeech = new TextToSpeech(getContext(), this);
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {}

            @Override
            public void onDone(String utteranceId) {
                resolvePendingSpeak(utteranceId);
            }

            @Override
            public void onError(String utteranceId) {
                rejectPendingSpeak(utteranceId, "Android text-to-speech failed.");
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                rejectPendingSpeak(utteranceId, "Android text-to-speech failed: " + errorCode);
            }
        });
    }

    @Override
    public void onInit(int status) {
        isReady = status == TextToSpeech.SUCCESS;
        if (!isReady) rejectPendingSpeak("Android text-to-speech is not available.");
        if (isReady && pendingSpeakCall != null && !pendingText.isEmpty()) {
            performSpeak(pendingText, pendingLang);
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", isReady && textToSpeech != null);
        call.resolve(result);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (textToSpeech == null) {
            call.reject("Android text-to-speech is not available.");
            return;
        }

        String text = call.getString("text", "").trim();
        String lang = call.getString("lang", "en").trim();
        if (text.isEmpty()) {
            call.reject("No text to speak.");
            return;
        }

        if (pendingSpeakCall != null) {
            pendingSpeakCall.reject("Interrupted by a new text-to-speech request.");
        }

        pendingSpeakCall = call;
        pendingText = text;
        pendingLang = lang;

        if (!isReady) return;

        performSpeak(text, lang);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (textToSpeech != null) textToSpeech.stop();
        if (pendingSpeakCall != null) {
            pendingSpeakCall.reject("Text-to-speech stopped.");
            pendingSpeakCall = null;
        }
        pendingText = "";
        pendingUtteranceId = "";
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
    }

    private void performSpeak(String text, String lang) {
        Locale locale = Locale.forLanguageTag(lang);
        int languageResult = textToSpeech.setLanguage(locale);
        if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            rejectPendingSpeak("Language is not available: " + lang);
            return;
        }

        textToSpeech.stop();
        String utteranceId = UUID.randomUUID().toString();
        pendingUtteranceId = utteranceId;
        Bundle params = new Bundle();
        params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);

        int result = textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
        if (result == TextToSpeech.ERROR) {
            rejectPendingSpeak("Could not start Android text-to-speech.");
        }
    }

    private void resolvePendingSpeak(String utteranceId) {
        getActivity().runOnUiThread(() -> {
            if (!utteranceId.equals(pendingUtteranceId)) return;
            if (pendingSpeakCall == null) return;
            pendingSpeakCall.resolve();
            pendingSpeakCall = null;
            pendingText = "";
            pendingUtteranceId = "";
        });
    }

    private void rejectPendingSpeak(String utteranceId, String message) {
        getActivity().runOnUiThread(() -> {
            if (!utteranceId.equals(pendingUtteranceId)) return;
            if (pendingSpeakCall == null) return;
            pendingSpeakCall.reject(message);
            pendingSpeakCall = null;
            pendingText = "";
            pendingUtteranceId = "";
        });
    }

    private void rejectPendingSpeak(String message) {
        getActivity().runOnUiThread(() -> {
            if (pendingSpeakCall == null) return;
            pendingSpeakCall.reject(message);
            pendingSpeakCall = null;
            pendingText = "";
            pendingUtteranceId = "";
        });
    }
}
