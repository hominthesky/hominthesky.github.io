var userid = "219758976";
var accessToken = "219758976.1677ed0.787897fb29d441d4b891f3d8c4c46b59";

var instagramBaseUrl = "https://api.instagram.com/v1/users/"+userid+"/media/recent/?access_token="+accessToken;
  $.ajax({
    type:"GET",
    dataType:"jsonp",
    url: instagramBaseUrl,
    success:function(data) {
    console.log(data);
    var row = $('#ins');

    for(var i=0; i<data.data.length; i++) {
      var itemWrapper = $('<div class="wrapper"></div>');
      row.append(itemWrapper);
      var item = $('<a target="_blank" href="'+data.data[i].link+'" class="ins-item"></a>');
      item.append('<img class="thumbnail" src="'+data.data[i].images.standard_resolution.url+'" />');
      itemWrapper.append(item);
    }
  },
      error: function(data){
          console.log('error',data); // send the error notifications to console
        }
    });
