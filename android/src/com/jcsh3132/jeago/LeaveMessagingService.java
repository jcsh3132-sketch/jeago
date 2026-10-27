package com.jcsh3132.jeago;
import com.google.firebase.messaging.FirebaseMessagingService;import com.google.firebase.messaging.RemoteMessage;
public final class LeaveMessagingService extends FirebaseMessagingService {
 @Override public void onNewToken(String token){LeavePush.register(this,token);}
 @Override public void onMessageReceived(RemoteMessage message){if(!"leave_approval".equals(message.getData().get("type")))return;String id=message.getData().get("eventId"),stage=message.getData().get("stage");if(id!=null)LeavePush.receive(this,id,"1".equals(stage)?1:"2".equals(stage)?2:0);}
}
