$(document).ready(function(){
  $("a.navbar-toggle").click(function(e){
    e.preventDefault();
    $(".nav-item").addClass("open");
    $(".nav-item").slideToggle()
});
  });
