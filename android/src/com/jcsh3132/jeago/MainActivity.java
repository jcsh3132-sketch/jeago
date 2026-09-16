package com.jcsh3132.jeago;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Opens the shared inventory website; no credentials are stored in this APK. */
public final class MainActivity extends Activity {
    private static final String SITE = "https://jeago.vercel.app/";
    private static final int INK = Color.rgb(16, 43, 54);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(INK);
        root.setPadding(dp(28), dp(32), dp(28), dp(32));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(dp(28) + insets.getSystemWindowInsetLeft(),
                dp(32) + insets.getSystemWindowInsetTop(),
                dp(28) + insets.getSystemWindowInsetRight(),
                dp(32) + insets.getSystemWindowInsetBottom());
            return insets;
        });
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_launcher);
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        root.addView(icon, new LinearLayout.LayoutParams(dp(100), dp(100)));
        TextView title = text("재고 관리", 30, Color.WHITE);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title);
        TextView detail = text("우리 팀의 재고를 함께 관리하세요.", 16, Color.rgb(189, 211, 218));
        detail.setPadding(0, dp(16), 0, dp(30));
        root.addView(detail);
        Button open = new Button(this);
        open.setText("재고 관리 열기");
        open.setTextSize(17);
        open.setOnClickListener(view -> openInventory());
        root.addView(open, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)));
        TextView note = text("로그인 후 이용할 수 있습니다.\n자동로그인은 로그인 화면에서 설정하세요.", 13, Color.rgb(189, 211, 218));
        note.setPadding(0, dp(24), 0, 0);
        root.addView(note);
        setContentView(root);
        root.requestApplyInsets();
        // Returning from the browser leaves the launch screen available without a redirect loop.
        if (state == null) openInventory();
    }

    private void openInventory() {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(SITE));
        Bundle extras = new Bundle();
        // Documented Custom Tabs protocol; null session shares the default browser's cookies.
        extras.putBinder("android.support.customtabs.extra.SESSION", null);
        intent.putExtras(extras);
        intent.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", INK);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "Chrome 또는 인터넷 브라우저를 설치한 후 다시 열어주세요.", Toast.LENGTH_LONG).show();
        }
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER);
        return view;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
