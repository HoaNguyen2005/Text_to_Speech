// Private voices are owner-only, including when the other account is an admin.
const owned = (voice,user) => Boolean(user && voice.user_id && String(voice.user_id)===String(user._id));
const visible = (voice,user) => Boolean(voice && (voice.is_global || owned(voice,user)));
const editable = (voice,user) => Boolean(voice && user && (voice.is_global ? user.role==='admin' : owned(voice,user)));
const filter = user => user ? {$or:[{is_global:true},{user_id:user._id}]} : {is_global:true};
const present = (voice,user) => ({...voice.toObject?.()||voice,can_edit:editable(voice,user)});
module.exports={visible,editable,filter,present};
